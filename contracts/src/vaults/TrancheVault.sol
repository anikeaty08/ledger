// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title TrancheVault
/// @notice ERC-4626 MUSD vault that funds invoice advances. Deployed twice:
///         - Senior (lsMUSD): repaid first, second loss, 70% of advance fees.
///         - Junior (ljMUSD): first loss, 30% of advance fees on a smaller base, withdrawal cooldown.
///
///         Accounting:  totalAssets = idle + parked-in-sink + deployed principal − still-locked profit
///         Fees and recoveries unlock linearly over `profitUnlockTime` so nobody can sandwich a settlement.
///         Idle MUSD can be parked in an ERC-4626 "sink" (e.g. a MUSD savings vault) for a floor yield.
contract TrancheVault is ERC4626, Ownable2Step {
    using SafeERC20 for IERC20;

    address public engine;
    address public keeper;
    uint256 public deployed; // principal currently lent out
    uint256 public totalLosses;
    uint256 public totalFeesEarned;

    // Linear profit unlock
    uint256 public profitUnlockTime = 7 days;
    uint256 public lockedProfitAtReport;
    uint256 public lastReport;

    // Idle-cash sink
    IERC4626 public sink;

    // Withdrawal cooldown (0 = instant)
    uint256 public cooldown;
    uint256 public withdrawWindow = 3 days;
    mapping(address => uint256) public withdrawRequestedAt;

    event EngineSet(address engine);
    event KeeperSet(address keeper);
    event SinkSet(address sink);
    event Funded(uint256 amount, uint256 deployed);
    event Repaid(uint256 principal, uint256 fee);
    event TrancheLoss(uint256 principalLost, uint256 totalLosses);
    event Recovered(uint256 amount);
    event Parked(uint256 assets);
    event Unparked(uint256 assets);
    event WithdrawRequested(address indexed owner, uint256 at);
    event CooldownSet(uint256 cooldown, uint256 window);

    error OnlyEngine();
    error OnlyKeeper();
    error InsufficientLiquidity();
    error CooldownActive();
    error BadParams();

    constructor(IERC20 musd, string memory name_, string memory symbol_, address owner_, uint256 cooldown_)
        ERC4626(musd)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        cooldown = cooldown_;
        lastReport = block.timestamp;
    }

    modifier onlyEngine() {
        if (msg.sender != engine) revert OnlyEngine();
        _;
    }

    modifier onlyKeeperOrOwner() {
        if (msg.sender != keeper && msg.sender != owner()) revert OnlyKeeper();
        _;
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setEngine(address e) external onlyOwner {
        engine = e;
        emit EngineSet(e);
    }

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function setSink(IERC4626 s) external onlyOwner {
        if (address(sink) != address(0) && sink.balanceOf(address(this)) > 0) revert BadParams();
        if (address(s) != address(0) && s.asset() != asset()) revert BadParams();
        sink = s;
        emit SinkSet(address(s));
    }

    function setCooldown(uint256 cooldown_, uint256 window_) external onlyOwner {
        if (window_ == 0 || cooldown_ > 30 days) revert BadParams();
        (cooldown, withdrawWindow) = (cooldown_, window_);
        emit CooldownSet(cooldown_, window_);
    }

    function setProfitUnlockTime(uint256 t) external onlyOwner {
        if (t > 30 days) revert BadParams();
        lockedProfitAtReport = lockedProfit();
        lastReport = block.timestamp;
        profitUnlockTime = t;
    }

    // ───────────────────────────── Sink management ─────────────────────────────

    function park(uint256 assets) external onlyKeeperOrOwner {
        IERC20 token = IERC20(asset());
        token.forceApprove(address(sink), assets);
        sink.deposit(assets, address(this));
        emit Parked(assets);
    }

    function unpark(uint256 assets) external onlyKeeperOrOwner {
        _unpark(assets);
    }

    // ───────────────────────────── Engine hooks ─────────────────────────────

    function fund(uint256 amount) external onlyEngine {
        _ensureIdle(amount);
        deployed += amount;
        IERC20(asset()).safeTransfer(engine, amount);
        emit Funded(amount, deployed);
    }

    /// @dev Engine transfers `principal + fee` MUSD to this vault before calling.
    function onRepay(uint256 principal, uint256 fee) external onlyEngine {
        deployed -= principal;
        if (fee > 0) {
            totalFeesEarned += fee;
            _lockProfit(fee);
        }
        emit Repaid(principal, fee);
    }

    function onLoss(uint256 principalLost) external onlyEngine {
        deployed -= principalLost;
        totalLosses += principalLost;
        emit TrancheLoss(principalLost, totalLosses);
    }

    /// @dev Engine transfers `amount` MUSD before calling (late recovery after a default).
    function onRecovery(uint256 amount) external onlyEngine {
        _lockProfit(amount);
        emit Recovered(amount);
    }

    // ───────────────────────────── Withdrawal cooldown ─────────────────────────────

    function requestWithdraw() external {
        withdrawRequestedAt[msg.sender] = block.timestamp;
        emit WithdrawRequested(msg.sender, block.timestamp);
    }

    function cooldownSatisfied(address owner_) public view returns (bool) {
        if (cooldown == 0) return true;
        uint256 at = withdrawRequestedAt[owner_];
        return at != 0 && block.timestamp >= at + cooldown && block.timestamp <= at + cooldown + withdrawWindow;
    }

    // ───────────────────────────── ERC-4626 overrides ─────────────────────────────

    function totalAssets() public view override returns (uint256) {
        uint256 gross = _idle() + _sinkAssets() + deployed;
        uint256 locked = lockedProfit();
        return gross > locked ? gross - locked : 0;
    }

    function availableLiquidity() public view returns (uint256) {
        return _idle() + (address(sink) == address(0) ? 0 : sink.maxWithdraw(address(this)));
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        if (!cooldownSatisfied(owner_)) return 0;
        return Math.min(super.maxWithdraw(owner_), availableLiquidity());
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        if (!cooldownSatisfied(owner_)) return 0;
        return Math.min(super.maxRedeem(owner_), _convertToShares(availableLiquidity(), Math.Rounding.Floor));
    }

    function lockedProfit() public view returns (uint256) {
        uint256 elapsed = block.timestamp - lastReport;
        if (elapsed >= profitUnlockTime || profitUnlockTime == 0) return 0;
        return lockedProfitAtReport - (lockedProfitAtReport * elapsed) / profitUnlockTime;
    }

    function utilizationBps() external view returns (uint256) {
        uint256 gross = _idle() + _sinkAssets() + deployed;
        return gross == 0 ? 0 : (deployed * 10_000) / gross;
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        if (!cooldownSatisfied(owner_)) revert CooldownActive();
        _ensureIdle(assets);
        if (cooldown != 0) delete withdrawRequestedAt[owner_];
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6; // inflation-attack protection (virtual shares)
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _idle() internal view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function _sinkAssets() internal view returns (uint256) {
        if (address(sink) == address(0)) return 0;
        return sink.convertToAssets(sink.balanceOf(address(this)));
    }

    function _ensureIdle(uint256 amount) internal {
        uint256 idle = _idle();
        if (idle >= amount) return;
        if (address(sink) == address(0)) revert InsufficientLiquidity();
        _unpark(amount - idle);
        if (_idle() < amount) revert InsufficientLiquidity();
    }

    function _unpark(uint256 assets) internal {
        uint256 maxOut = sink.maxWithdraw(address(this));
        if (assets > maxOut) assets = maxOut;
        if (assets == 0) return;
        sink.withdraw(assets, address(this), address(this));
        emit Unparked(assets);
    }

    function _lockProfit(uint256 amount) internal {
        lockedProfitAtReport = lockedProfit() + amount;
        lastReport = block.timestamp;
    }
}
