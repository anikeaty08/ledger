// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Minimal interfaces for the Mezo contracts Ledger integrates with.
// Signatures mirror github.com/mezo-org/musd (solidity/contracts/interfaces)
// and github.com/mezo-org/tigris (solidity/contracts/interfaces/IRouter.sol).

interface IBorrowerOperations {
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;
    function addColl(address _upperHint, address _lowerHint) external payable;
    function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;
    function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;
    function adjustTrove(
        uint256 _collWithdrawal,
        uint256 _debtChange,
        bool _isDebtIncrease,
        address _upperHint,
        address _lowerHint
    ) external payable;
    function closeTrove() external;
    function minNetDebt() external view returns (uint256);
}

interface ITroveManager {
    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);
    function getTroveDebt(address _borrower) external view returns (uint256);
    function getTroveColl(address _borrower) external view returns (uint256);
    function getTroveStatus(address _borrower) external view returns (uint256);
}

interface IPriceFeed {
    /// @return BTC/USD price with 1e18 precision.
    function fetchPrice() external view returns (uint256);
}

interface IMezoRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, Route[] memory routes)
        external
        view
        returns (uint256[] memory amounts);
}

/// @dev Optional wrapper used off-Mezo (tests / other EVMs) where native gas is not also an ERC-20.
///      On Mezo, native BTC and the BTC ERC-20 precompile share one balance, so no wrapping is needed.
interface IWrappedNative {
    function deposit() external payable;
}
