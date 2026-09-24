// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Invoice, InvoiceStatus} from "../libraries/Types.sol";

interface IInvoiceRegistry {
    function getInvoice(uint256 id) external view returns (Invoice memory);
    function setStatus(uint256 id, InvoiceStatus status) external;
    function recordPayment(uint256 id, uint256 credited) external returns (bool fullyPaid);
    function amountOwed(uint256 id) external view returns (uint256);
    function lateFee(uint256 id) external view returns (uint256);
    function receivable() external view returns (address);
}

interface IReputationRegistry {
    function recordSettlement(address payer, address issuer, uint256 amount, uint256 daysLate) external;
    function recordPayerDefault(address payer, address issuer, uint256 amount) external;
    function recordIssuerFault(address issuer, uint256 amount) external;
    function clientScore(address payer) external view returns (uint256);
    function hasHistory(address payer) external view returns (bool);
    function issuerFaults(address issuer) external view returns (uint256);
}

interface ICreditPolicy {
    struct Terms {
        bool eligible;
        uint16 advanceRateBps;
        uint16 feePer30dBps;
        uint16 recourseBps;
    }

    function terms(address payer, address issuer) external view returns (Terms memory);
}

interface ITrancheVault {
    function fund(uint256 amount) external;
    function onRepay(uint256 principal, uint256 fee) external;
    function onLoss(uint256 principalLost) external;
    function onRecovery(uint256 amount) external;
    function availableLiquidity() external view returns (uint256);
    function totalAssets() external view returns (uint256);
}

interface IAdvanceEngine {
    function hasActiveAdvance(uint256 invoiceId) external view returns (bool);
    function borrowerOf(uint256 invoiceId) external view returns (address);
    function applyPayment(uint256 invoiceId, uint256 amount) external returns (uint256 toVaults);
    function applyRecovery(uint256 invoiceId, uint256 amount) external returns (uint256 toVaults);
    function closeOnSettlement(uint256 invoiceId) external;
    function onDefault(uint256 invoiceId) external;
    function vaultDue(uint256 invoiceId) external view returns (uint256);
    function recoveryDue(uint256 invoiceId) external view returns (uint256);
}

interface IBTCSwapper {
    function btcValue(uint256 btcAmount) external view returns (uint256);
    function swapBTCForMUSD(uint256 minOut, address to) external payable returns (uint256 out);
}

interface ILedgerAccount {
    function owner() external view returns (address);
    function borrowAgainstBTC(uint256 debt, address upperHint, address lowerHint)
        external
        payable
        returns (uint256 minted);
    function onIncome(uint256 amount) external;
}

interface ILedgerAccountFactory {
    function accountOf(address user) external view returns (address);
}

interface ISplitter {
    function distribute(address token) external;
}
