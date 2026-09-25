// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Invoice, InvoiceStatus} from "../libraries/Types.sol";
import {IInvoiceRegistry, IAdvanceEngine, IReputationRegistry} from "../interfaces/ILedger.sol";

/// @title CollectionsManager
/// @notice Overdue → grace → default, plus dispute resolution.
///         - `declareDefault` is permissionless once the grace period has passed.
///         - Disputes are resolved by a resolver (2-of-3 multisig in production):
///             payer at fault  → invoice goes back to its prior state (or Overdue if past due)
///             issuer at fault → invoice is voided as Defaulted; recourse is seized; issuer fault recorded
///         - `reportDiversion` handles a client paying the freelancer off-router on a financed invoice.
contract CollectionsManager is Ownable2Step {
    IInvoiceRegistry public immutable registry;
    IAdvanceEngine public immutable engine;
    IReputationRegistry public immutable reputation;

    address public resolver;
    uint64 public gracePeriod = 15 days;

    event ResolverSet(address indexed resolver);
    event GracePeriodSet(uint64 grace);
    event Defaulted(uint256 indexed invoiceId, address indexed payer, uint256 owed);
    event DisputeResolved(uint256 indexed invoiceId, bool payerAtFault);
    event DiversionReported(uint256 indexed invoiceId, address indexed issuer);

    error NotResolver();
    error BadStatus(InvoiceStatus status);
    error GraceNotOver();
    error BadParams();

    constructor(address owner_, IInvoiceRegistry registry_, IAdvanceEngine engine_, IReputationRegistry rep_, address resolver_)
        Ownable(owner_)
    {
        registry = registry_;
        engine = engine_;
        reputation = rep_;
        resolver = resolver_;
    }

    modifier onlyResolver() {
        if (msg.sender != resolver) revert NotResolver();
        _;
    }

    function setResolver(address r) external onlyOwner {
        resolver = r;
        emit ResolverSet(r);
    }

    function setGracePeriod(uint64 g) external onlyOwner {
        if (g > 90 days) revert BadParams();
        gracePeriod = g;
        emit GracePeriodSet(g);
    }

    function defaultableAt(uint256 invoiceId) public view returns (uint256) {
        return uint256(registry.getInvoice(invoiceId).dueDate) + gracePeriod;
    }

    /// @notice Permissionless: default an unpaid invoice after due date + grace.
    function declareDefault(uint256 invoiceId) external {
        Invoice memory inv = registry.getInvoice(invoiceId);
        InvoiceStatus s = inv.status;
        if (
            s != InvoiceStatus.Accepted && s != InvoiceStatus.Financed && s != InvoiceStatus.PartiallyPaid
                && s != InvoiceStatus.Overdue
        ) revert BadStatus(s);
        if (block.timestamp <= defaultableAt(invoiceId)) revert GraceNotOver();

        uint256 owed = registry.amountOwed(invoiceId);
        if (engine.hasActiveAdvance(invoiceId)) engine.onDefault(invoiceId);
        registry.setStatus(invoiceId, InvoiceStatus.Defaulted);
        reputation.recordPayerDefault(inv.payer, inv.issuer, owed);
        emit Defaulted(invoiceId, inv.payer, owed);
    }

    function resolveDispute(uint256 invoiceId, bool payerAtFault) external onlyResolver {
        Invoice memory inv = registry.getInvoice(invoiceId);
        if (inv.status != InvoiceStatus.Disputed) revert BadStatus(inv.status);

        if (payerAtFault) {
            InvoiceStatus restore = block.timestamp > inv.dueDate ? InvoiceStatus.Overdue : inv.statusBeforeDispute;
            registry.setStatus(invoiceId, restore);
        } else {
            if (engine.hasActiveAdvance(invoiceId)) engine.onDefault(invoiceId);
            registry.setStatus(invoiceId, InvoiceStatus.Defaulted);
            reputation.recordIssuerFault(inv.issuer, inv.amount);
        }
        emit DisputeResolved(invoiceId, payerAtFault);
    }

    /// @notice The client paid the freelancer directly while the invoice was financed and the freelancer
    ///         did not forward it through the router. Seizes recourse and records an issuer fault.
    function reportDiversion(uint256 invoiceId) external onlyResolver {
        Invoice memory inv = registry.getInvoice(invoiceId);
        if (!engine.hasActiveAdvance(invoiceId)) revert BadStatus(inv.status);
        engine.onDefault(invoiceId);
        registry.setStatus(invoiceId, InvoiceStatus.Defaulted);
        reputation.recordIssuerFault(inv.issuer, inv.amount);
        emit DiversionReported(invoiceId, inv.issuer);
    }
}
