// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IMezoRouter} from "../../src/interfaces/IMezo.sol";

contract MockMUSD is ERC20 {
    constructor() ERC20("Mezo USD", "MUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @dev WETH-style wrapper standing in for Mezo's BTC ERC-20 precompile in local tests.
contract MockBTC is ERC20 {
    constructor() ERC20("Bitcoin", "BTC") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }
}

contract MockPriceFeed {
    uint256 public price;

    constructor(uint256 p) {
        price = p;
    }

    function set(uint256 p) external {
        price = p;
    }

    function fetchPrice() external view returns (uint256) {
        return price;
    }
}

/// @dev tigris-style router quoting BTC→MUSD at oracle price minus a 0.3% fee (+ optional skew).
contract MockRouter {
    MockPriceFeed public feed;
    MockMUSD public musd;
    ERC20 public btc;
    uint256 public skewBps; // extra discount to simulate a manipulated / thin pool

    constructor(MockPriceFeed f, MockMUSD m, ERC20 b) {
        feed = f;
        musd = m;
        btc = b;
    }

    function setSkew(uint256 bps) external {
        skewBps = bps;
    }

    function _out(uint256 amountIn) internal view returns (uint256) {
        return (amountIn * feed.price() / 1e18) * (10_000 - 30 - skewBps) / 10_000;
    }

    function getAmountsOut(uint256 amountIn, IMezoRouter.Route[] memory routes)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;
        amounts[routes.length] = _out(amountIn);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        IMezoRouter.Route[] calldata routes,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        btc.transferFrom(msg.sender, address(this), amountIn);
        uint256 out = _out(amountIn);
        require(out >= amountOutMin, "INSUFFICIENT_OUTPUT");
        musd.mint(to, out);
        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;
        amounts[routes.length] = out;
    }
}

/// @dev Minimal MUSD CDP (BorrowerOperations + TroveManager) with Mezo's semantics:
///      borrower receives `_debtAmount`; 0.1% borrowing fee and 200 MUSD gas compensation are added to
///      the recorded debt; minimum net debt 1800 MUSD; MCR 110%.
contract MockMezoCDP {
    struct Trove {
        uint256 coll;
        uint256 debt;
        uint256 status; // 0 none, 1 active, 2 closed
    }

    MockMUSD public musd;
    MockPriceFeed public feed;
    mapping(address => Trove) public troves;
    uint256 public minNetDebt = 1800e18;
    uint256 public constant GAS_COMP = 200e18;
    uint256 public constant MCR = 1.1e18;

    constructor(MockMUSD m, MockPriceFeed f) {
        musd = m;
        feed = f;
    }

    function setMinNetDebt(uint256 v) external {
        minNetDebt = v;
    }

    function openTrove(uint256 _debtAmount, address, address) external payable {
        Trove storage t = troves[msg.sender];
        require(t.status != 1, "active");
        uint256 fee = _debtAmount / 1000;
        require(_debtAmount + fee >= minNetDebt, "min net debt");
        t.coll = msg.value;
        t.debt = _debtAmount + fee + GAS_COMP;
        t.status = 1;
        require(_icr(msg.sender) >= MCR, "ICR < MCR");
        musd.mint(msg.sender, _debtAmount);
    }

    function addColl(address, address) external payable {
        Trove storage t = troves[msg.sender];
        require(t.status == 1, "inactive");
        t.coll += msg.value;
    }

    function adjustTrove(uint256 collWithdrawal, uint256 debtChange, bool isDebtIncrease, address, address)
        external
        payable
    {
        Trove storage t = troves[msg.sender];
        require(t.status == 1, "inactive");
        t.coll = t.coll + msg.value - collWithdrawal;
        if (isDebtIncrease) {
            uint256 fee = debtChange / 1000;
            t.debt += debtChange + fee;
            musd.mint(msg.sender, debtChange);
        } else {
            require(t.debt - debtChange >= minNetDebt + GAS_COMP, "below min");
            musd.burn(msg.sender, debtChange);
            t.debt -= debtChange;
        }
        require(_icr(msg.sender) >= MCR, "ICR < MCR");
        if (collWithdrawal > 0) payable(msg.sender).transfer(collWithdrawal);
    }

    function repayMUSD(uint256 amount, address, address) external {
        Trove storage t = troves[msg.sender];
        require(t.status == 1, "inactive");
        require(t.debt - amount >= minNetDebt + GAS_COMP, "below min");
        musd.burn(msg.sender, amount);
        t.debt -= amount;
    }

    function withdrawMUSD(uint256 amount, address, address) external {
        Trove storage t = troves[msg.sender];
        t.debt += amount + amount / 1000;
        require(_icr(msg.sender) >= MCR, "ICR < MCR");
        musd.mint(msg.sender, amount);
    }

    function closeTrove() external {
        Trove storage t = troves[msg.sender];
        require(t.status == 1, "inactive");
        musd.burn(msg.sender, t.debt - GAS_COMP);
        uint256 c = t.coll;
        t.coll = 0;
        t.debt = 0;
        t.status = 2;
        payable(msg.sender).transfer(c);
    }

    // ── TroveManager views ──
    function getCurrentICR(address b, uint256 price) public view returns (uint256) {
        Trove storage t = troves[b];
        if (t.debt == 0) return type(uint256).max;
        return (t.coll * price) / t.debt;
    }

    function _icr(address b) internal view returns (uint256) {
        return getCurrentICR(b, feed.price());
    }

    function getTroveDebt(address b) external view returns (uint256) {
        return troves[b].debt;
    }

    function getTroveColl(address b) external view returns (uint256) {
        return troves[b].coll;
    }

    function getTroveStatus(address b) external view returns (uint256) {
        return troves[b].status;
    }
}

/// @dev Stand-in for an external MUSD savings vault (yield target). `accrue` simulates yield.
contract MockSavingsVault is ERC4626 {
    constructor(IERC20 musd) ERC4626(musd) ERC20("Savings MUSD", "sMUSD") {}

    function accrue(uint256 amount) external {
        MockMUSD(asset()).mint(address(this), amount);
    }
}
