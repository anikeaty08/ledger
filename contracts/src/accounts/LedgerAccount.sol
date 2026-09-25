// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed} from "../interfaces/IMezo.sol";

interface IAccountFactoryConfig {
    function borrowerOperations() external view returns (IBorrowerOperations);
    function troveManager() external view returns (ITroveManager);
    function priceFeed() external view returns (IPriceFeed);
    function musd() external view returns (IERC20);
    function router() external view returns (address);
    function minICRBps() external view returns (uint16);
}

/// @title LedgerAccount
/// @notice A user's own smart account (minimal-proxy clone) on Mezo. It:
///   - owns the user's MUSD position (trove) so BTC invoice payments can be kept as collateral ("Keep-BTC");
///   - runs the treasury: idle-MUSD yield (any ERC-4626 vault) + automatic debt paydown;
///   - runs the guardian: permissionless keepers can only REDUCE risk (repay / add collateral) within
///     daily limits the owner sets. Keepers can never borrow, withdraw collateral, or move funds out.
///   The owner keeps full control through `execute` and the withdraw helpers.
contract LedgerAccount is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant TROVE_ACTIVE = 1; // ITroveManager.Status.active

    struct TreasuryConfig {
        IERC4626 yieldVault; // where idle MUSD earns (e.g. MUSD savings vault or Ledger senior tranche)
        bool autoSweep; // sweep incoming income into yieldVault
        uint16 paydownBps; // share of every income reserved for repaying the MUSD debt
    }

    struct GuardianConfig {
        bool enabled;
        uint16 warnICRBps; // e.g. 18000 = 180% → off-chain alert only
        uint16 actionICRBps; // below → repay from treasury
        uint16 targetICRBps; // restore to this ratio
        uint16 criticalICRBps; // below → add BTC from the buffer
        uint128 maxDailyRepay; // MUSD
        uint128 maxDailyBTC; // BTC (wei)
    }

    address public owner;
    IAccountFactoryConfig public factory;

    TreasuryConfig public treasury;
    GuardianConfig public guardian;

    uint256 public reservedForPaydown; // MUSD earmarked for debt paydown
    uint256 public yieldPrincipal; // MUSD deposited into yieldVault (for harvest accounting)
    uint256 public guardianDay;
    uint256 public repaidToday;
    uint256 public btcAddedToday;

    event Initialized(address indexed owner);
    event TreasuryConfigured(address indexed yieldVault, bool autoSweep, uint16 paydownBps);
    event GuardianConfigured(GuardianConfig cfg);
    event BorrowedAgainstBTC(uint256 btcIn, uint256 musdMinted);
    event Income(uint256 amount, uint256 reserved, uint256 swept);
    event Swept(uint256 assets);
    event Harvested(uint256 yield);
    event PaidDown(uint256 amount);
    event GuardianRepaid(uint256 icrBefore, uint256 amount);
    event GuardianAddedCollateral(uint256 icrBefore, uint256 btc);
    event Executed(address indexed target, uint256 value, bytes data);

    error NotOwner();
    error NotRouter();
    error BadConfig();
    error UnsafeICR(uint256 icr);
    error NothingToDo();
    error BadPrice();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        owner = owner_;
        factory = IAccountFactoryConfig(msg.sender);
        guardian = GuardianConfig(false, 18_000, 15_000, 20_000, 12_500, 0, 0);
        emit Initialized(owner_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRouter() {
        if (msg.sender != factory.router()) revert NotRouter();
        _;
    }

    receive() external payable {}

    // ───────────────────────────── Owner config ─────────────────────────────

    function configureTreasury(IERC4626 yieldVault, bool autoSweep, uint16 paydownBps) external onlyOwner {
        if (paydownBps > 10_000) revert BadConfig();
        if (address(yieldVault) != address(0) && yieldVault.asset() != address(factory.musd())) revert BadConfig();
        if (address(treasury.yieldVault) != address(0) && address(yieldVault) != address(treasury.yieldVault)) {
            _withdrawAllYield(); // migrate out of the old vault
        }
        treasury = TreasuryConfig(yieldVault, autoSweep, paydownBps);
        emit TreasuryConfigured(address(yieldVault), autoSweep, paydownBps);
    }

    function configureGuardian(GuardianConfig calldata cfg) external onlyOwner {
        if (
            cfg.criticalICRBps < 11_000 || cfg.criticalICRBps >= cfg.actionICRBps || cfg.actionICRBps >= cfg.targetICRBps
                || cfg.warnICRBps < cfg.actionICRBps
        ) revert BadConfig();
        guardian = cfg;
        emit GuardianConfigured(cfg);
    }

    /// @notice Full owner control (escape hatch): manage the trove directly, move tokens, etc.
    function execute(address target, uint256 value, bytes calldata data)
        external
        onlyOwner
        nonReentrant
        returns (bytes memory result)
    {
        result = Address.functionCallWithValue(target, data, value);
        emit Executed(target, value, data);
    }

    function withdrawMUSD(uint256 amount, address to) external onlyOwner nonReentrant {
        IERC20 musd = factory.musd();
        uint256 bal = musd.balanceOf(address(this));
        if (amount > bal) {
            _withdrawYield(amount - bal);
        }
        reservedForPaydown = reservedForPaydown > amount ? reservedForPaydown - amount : 0;
        musd.safeTransfer(to, amount);
    }

    function withdrawBTC(uint256 amount, address payable to) external onlyOwner nonReentrant {
        Address.sendValue(to, amount);
    }

    // ───────────────────────────── Router hooks ─────────────────────────────

    /// @notice Keep-BTC: deposit attached BTC as trove collateral and mint `debt` MUSD to the router.
    function borrowAgainstBTC(uint256 debt, address upperHint, address lowerHint)
        external
        payable
        onlyRouter
        nonReentrant
        returns (uint256 minted)
    {
        IBorrowerOperations bo = factory.borrowerOperations();
        IERC20 musd = factory.musd();
        uint256 before = musd.balanceOf(address(this));
        if (_troveActive()) {
            bo.adjustTrove{value: msg.value}(0, debt, true, upperHint, lowerHint);
        } else {
            bo.openTrove{value: msg.value}(debt, upperHint, lowerHint);
        }
        minted = musd.balanceOf(address(this)) - before;

        uint256 icr = currentICR();
        if (icr < uint256(factory.minICRBps()) * 1e14) revert UnsafeICR(icr);

        musd.safeTransfer(msg.sender, minted);
        emit BorrowedAgainstBTC(msg.value, minted);
    }

    /// @notice Router sent `amount` MUSD of invoice income to this account.
    function onIncome(uint256 amount) external onlyRouter {
        uint256 reserved;
        if (treasury.paydownBps > 0 && _troveActive()) {
            reserved = (amount * treasury.paydownBps) / 10_000;
            reservedForPaydown += reserved;
        }
        uint256 swept;
        if (treasury.autoSweep && address(treasury.yieldVault) != address(0)) {
            swept = amount - reserved;
            _deposit(swept);
        }
        emit Income(amount, reserved, swept);
    }

    // ───────────────────────────── Treasury (keeper-callable) ─────────────────────────────

    function sweepToYield(uint256 amount) external onlyOwner {
        _deposit(amount);
    }

    /// @notice Permissionless: harvest yield and apply it + reserved income to the MUSD debt.
    ///         Never repays below MUSD's minimum net debt (the owner closes the trove via `execute`).
    function paydown(address upperHint, address lowerHint) external nonReentrant returns (uint256 amount) {
        if (!_troveActive()) revert NothingToDo();
        uint256 y = _harvest();
        amount = reservedForPaydown + y;
        uint256 headroom = _repayHeadroom();
        if (amount > headroom) amount = headroom;
        IERC20 musd = factory.musd();
        uint256 bal = musd.balanceOf(address(this));
        if (amount > bal) amount = bal;
        if (amount == 0) revert NothingToDo();

        reservedForPaydown = reservedForPaydown > amount ? reservedForPaydown - amount : 0;
        _repay(amount, upperHint, lowerHint);
        emit PaidDown(amount);
    }

    // ───────────────────────────── Guardian (keeper-callable) ─────────────────────────────

    /// @notice Permissionless risk reduction. Repays from treasury MUSD when ICR < action threshold,
    ///         then adds BTC from this account's buffer when still below the critical threshold.
    function guardianCheck(address upperHint, address lowerHint) external nonReentrant {
        GuardianConfig memory g = guardian;
        if (!g.enabled || !_troveActive()) revert NothingToDo();
        _rollDay();

        uint256 price = _safePrice();
        ITroveManager tm = factory.troveManager();
        uint256 icr = tm.getCurrentICR(address(this), price);
        bool acted;

        if (icr < uint256(g.actionICRBps) * 1e14) {
            uint256 debt = tm.getTroveDebt(address(this));
            uint256 coll = tm.getTroveColl(address(this));
            uint256 targetDebt = (coll * price) / (uint256(g.targetICRBps) * 1e14);
            uint256 need = debt > targetDebt ? debt - targetDebt : 0;
            uint256 room = g.maxDailyRepay > repaidToday ? g.maxDailyRepay - repaidToday : 0;
            uint256 amount = Math.min(need, Math.min(room, _repayHeadroom()));

            IERC20 musd = factory.musd();
            uint256 bal = musd.balanceOf(address(this));
            if (amount > bal) {
                _withdrawYield(amount - bal);
                bal = musd.balanceOf(address(this));
                if (amount > bal) amount = bal;
            }
            if (amount > 0) {
                repaidToday += amount;
                reservedForPaydown = reservedForPaydown > amount ? reservedForPaydown - amount : 0;
                _repay(amount, upperHint, lowerHint);
                emit GuardianRepaid(icr, amount);
                acted = true;
                icr = tm.getCurrentICR(address(this), price);
            }
        }

        if (icr < uint256(g.criticalICRBps) * 1e14) {
            uint256 debt = tm.getTroveDebt(address(this));
            uint256 coll = tm.getTroveColl(address(this));
            uint256 targetColl = (debt * uint256(g.targetICRBps) * 1e14) / price;
            uint256 need = targetColl > coll ? targetColl - coll : 0;
            uint256 room = g.maxDailyBTC > btcAddedToday ? g.maxDailyBTC - btcAddedToday : 0;
            uint256 btc = Math.min(need, Math.min(room, address(this).balance));
            if (btc > 0) {
                btcAddedToday += btc;
                factory.borrowerOperations().addColl{value: btc}(upperHint, lowerHint);
                emit GuardianAddedCollateral(icr, btc);
                acted = true;
            }
        }
        if (!acted) revert NothingToDo();
    }

    // ───────────────────────────── Views ─────────────────────────────

    function currentICR() public view returns (uint256) {
        return factory.troveManager().getCurrentICR(address(this), _safePrice());
    }

    /// @dev Mirrors BTCSwapper's zero-price guard so a broken/uninitialized oracle fails loudly here
    ///      too, instead of silently producing icr == 0 (which happens to fail safe on every caller —
    ///      `borrowAgainstBTC` reverts via UnsafeICR, and `guardianCheck`'s critical-branch division by
    ///      `price` reverts on its own — but an explicit, named revert is clearer than a bare panic).
    function _safePrice() internal view returns (uint256 price) {
        price = factory.priceFeed().fetchPrice();
        if (price == 0) revert BadPrice();
    }

    function position() external view returns (uint256 coll, uint256 debt, uint256 icr, bool active) {
        ITroveManager tm = factory.troveManager();
        active = _troveActive();
        if (active) {
            coll = tm.getTroveColl(address(this));
            debt = tm.getTroveDebt(address(this));
            icr = currentICR();
        }
    }

    function yieldBalance() public view returns (uint256) {
        IERC4626 v = treasury.yieldVault;
        if (address(v) == address(0)) return 0;
        return v.convertToAssets(v.balanceOf(address(this)));
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _troveActive() internal view returns (bool) {
        return factory.troveManager().getTroveStatus(address(this)) == TROVE_ACTIVE;
    }

    function _repayHeadroom() internal view returns (uint256) {
        uint256 debt = factory.troveManager().getTroveDebt(address(this));
        uint256 floor = factory.borrowerOperations().minNetDebt();
        return debt > floor ? debt - floor : 0;
    }

    function _repay(uint256 amount, address upperHint, address lowerHint) internal {
        IERC20 musd = factory.musd();
        IBorrowerOperations bo = factory.borrowerOperations();
        musd.forceApprove(address(bo), amount);
        bo.repayMUSD(amount, upperHint, lowerHint);
    }

    function _deposit(uint256 amount) internal {
        IERC4626 v = treasury.yieldVault;
        if (address(v) == address(0) || amount == 0) return;
        factory.musd().forceApprove(address(v), amount);
        v.deposit(amount, address(this));
        yieldPrincipal += amount;
        emit Swept(amount);
    }

    function _harvest() internal returns (uint256 y) {
        uint256 bal = yieldBalance();
        if (bal <= yieldPrincipal) return 0;
        y = bal - yieldPrincipal;
        uint256 maxOut = treasury.yieldVault.maxWithdraw(address(this));
        if (y > maxOut) y = maxOut;
        if (y == 0) return 0;
        treasury.yieldVault.withdraw(y, address(this), address(this));
        emit Harvested(y);
    }

    function _withdrawYield(uint256 amount) internal {
        IERC4626 v = treasury.yieldVault;
        if (address(v) == address(0)) return;
        uint256 maxOut = v.maxWithdraw(address(this));
        if (amount > maxOut) amount = maxOut;
        if (amount == 0) return;
        v.withdraw(amount, address(this), address(this));
        yieldPrincipal = yieldPrincipal > amount ? yieldPrincipal - amount : 0;
    }

    function _withdrawAllYield() internal {
        IERC4626 v = treasury.yieldVault;
        uint256 shares = v.balanceOf(address(this));
        if (shares > 0) v.redeem(shares, address(this), address(this));
        yieldPrincipal = 0;
    }

    function _rollDay() internal {
        uint256 day = block.timestamp / 1 days;
        if (day != guardianDay) {
            guardianDay = day;
            repaidToday = 0;
            btcAddedToday = 0;
        }
    }
}
