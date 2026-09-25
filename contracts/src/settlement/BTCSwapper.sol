// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPriceFeed, IMezoRouter, IWrappedNative} from "../interfaces/IMezo.sol";
import {IBTCSwapper} from "../interfaces/ILedger.sol";

/// @title BTCSwapper
/// @notice Values BTC with Mezo's PriceFeed and converts BTC → MUSD through Mezo Pools (tigris Router)
///         with oracle-bounded slippage and a router-vs-oracle deviation check.
///         On Mezo, native BTC and the BTC ERC-20 precompile share a balance, so `wrapNative` is false.
contract BTCSwapper is Ownable2Step, IBTCSwapper {
    using SafeERC20 for IERC20;

    IPriceFeed public immutable priceFeed;
    IMezoRouter public immutable router;
    address public immutable btcToken;
    address public immutable musd;
    bool public immutable wrapNative;

    IMezoRouter.Route[] internal _route;
    uint16 public maxSlippageBps = 50; // 0.5% vs oracle
    uint16 public maxDeviationBps = 300; // router quote may not be >3% below oracle value

    event RouteSet();
    event ParamsSet(uint16 slippageBps, uint16 deviationBps);
    event Swapped(address indexed caller, uint256 btcIn, uint256 musdOut);

    error BadPrice();
    error PriceDeviation(uint256 oracleValue, uint256 routerQuote);
    error BadParams();

    constructor(
        address owner_,
        IPriceFeed priceFeed_,
        IMezoRouter router_,
        address btcToken_,
        address musd_,
        bool wrapNative_,
        IMezoRouter.Route[] memory route_
    ) Ownable(owner_) {
        priceFeed = priceFeed_;
        router = router_;
        btcToken = btcToken_;
        musd = musd_;
        wrapNative = wrapNative_;
        _setRoute(route_);
    }

    function setRoute(IMezoRouter.Route[] calldata route_) external onlyOwner {
        _setRoute(route_);
    }

    function setParams(uint16 slippageBps, uint16 deviationBps) external onlyOwner {
        if (slippageBps > 500 || deviationBps > 1_000) revert BadParams();
        (maxSlippageBps, maxDeviationBps) = (slippageBps, deviationBps);
        emit ParamsSet(slippageBps, deviationBps);
    }

    function route() external view returns (IMezoRouter.Route[] memory) {
        return _route;
    }

    /// @notice USD (≈ MUSD) value of `btcAmount` at the Mezo oracle price.
    function btcValue(uint256 btcAmount) public view returns (uint256) {
        uint256 price = priceFeed.fetchPrice();
        if (price == 0) revert BadPrice();
        return (btcAmount * price) / 1e18;
    }

    function btcPrice() external view returns (uint256) {
        return priceFeed.fetchPrice();
    }

    /// @notice Swap all attached BTC for MUSD, sent to `to`.
    /// @param minOut caller's own floor; the effective floor is max(minOut, oracle value − slippage)
    function swapBTCForMUSD(uint256 minOut, address to) external payable returns (uint256 out) {
        uint256 amountIn = msg.value;
        if (amountIn == 0) revert BadParams();
        uint256 oracleValue = btcValue(amountIn);

        uint256[] memory quote = router.getAmountsOut(amountIn, _route);
        uint256 quoted = quote[quote.length - 1];
        if (quoted * 10_000 < oracleValue * (10_000 - maxDeviationBps)) revert PriceDeviation(oracleValue, quoted);

        uint256 floor = (oracleValue * (10_000 - maxSlippageBps)) / 10_000;
        if (minOut > floor) floor = minOut;

        if (wrapNative) IWrappedNative(btcToken).deposit{value: amountIn}();
        IERC20(btcToken).forceApprove(address(router), amountIn);
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, floor, _route, to, block.timestamp);
        out = amounts[amounts.length - 1];
        emit Swapped(msg.sender, amountIn, out);
    }

    function _setRoute(IMezoRouter.Route[] memory route_) internal {
        if (route_.length == 0 || route_[0].from != btcToken || route_[route_.length - 1].to != musd) {
            revert BadParams();
        }
        delete _route;
        for (uint256 i; i < route_.length; ++i) {
            _route.push(route_[i]);
        }
        emit RouteSet();
    }
}
