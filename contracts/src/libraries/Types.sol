// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

enum InvoiceStatus {
    None,
    Issued,
    Accepted,
    Financed,
    PartiallyPaid,
    Overdue,
    Disputed,
    Settled,
    Defaulted,
    Cancelled
}

struct Invoice {
    address issuer; // freelancer who created the invoice
    address payer; // client obligated to pay (0 = open until acceptance)
    bytes32 commitment; // keccak256(encrypted terms || salt); terms stay off-chain
    uint128 amount; // face value in MUSD (1e18)
    uint128 paid; // cumulative value credited
    uint64 issuedAt;
    uint64 dueDate;
    uint64 acceptedAt;
    uint64 closedAt;
    InvoiceStatus status;
    InvoiceStatus statusBeforeDispute;
}

library LedgerMath {
    uint256 internal constant BPS = 10_000;

    function bps(uint256 amount, uint256 rateBps) internal pure returns (uint256) {
        return (amount * rateBps) / BPS;
    }

    function bpsUp(uint256 amount, uint256 rateBps) internal pure returns (uint256) {
        return (amount * rateBps + BPS - 1) / BPS;
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
