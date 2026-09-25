// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReceivableNFT, IRegistryView} from "./ReceivableNFT.sol";
import {Invoice, InvoiceStatus, LedgerMath} from "../libraries/Types.sol";
import {IInvoiceRegistry} from "../interfaces/ILedger.sol";

/// @title InvoiceRegistry
/// @notice Source of truth for invoice commitments and their lifecycle.
///         Terms (line items, names, emails) are encrypted off-chain; only a commitment hash lives here.
///         Client acceptance (EIP-712, gasless via relayer, EIP-1271 compatible) mints a ReceivableNFT.
contract InvoiceRegistry is Ownable2Step, EIP712, IInvoiceRegistry, IRegistryView {
    using LedgerMath for uint256;

    bytes32 public constant ACCEPTANCE_TYPEHASH = keccak256(
        "InvoiceAcceptance(uint256 invoiceId,bytes32 commitment,uint256 amount,uint64 dueDate,address payer,uint256 deadline)"
    );

    uint64 public constant MIN_TENOR = 1 days;
    uint64 public constant MAX_TENOR = 180 days;

    ReceivableNFT public immutable receivableNFT;

    uint256 public nextId = 1;
    mapping(uint256 => Invoice) internal _invoices;
    mapping(address => bool) public isModule; // AdvanceEngine, SettlementRouter, CollectionsManager

    // Late fee: `lateFeeBps` per started `lateFeePeriod` after the due date, capped at `lateFeeCapBps`.
    uint16 public lateFeeBps = 100; // 1%
    uint32 public lateFeePeriod = 15 days;
    uint16 public lateFeeCapBps = 500; // 5%
    uint32 public disputeWindow = 7 days; // disputes allowed until dueDate + window

    event InvoiceCreated(
        uint256 indexed id,
        address indexed issuer,
        address indexed payer,
        uint256 amount,
        uint64 dueDate,
        bytes32 commitment
    );
    event InvoiceCancelled(uint256 indexed id);
    event InvoiceAccepted(uint256 indexed id, address indexed payer);
    event InvoiceStatusChanged(uint256 indexed id, InvoiceStatus from, InvoiceStatus to);
    event PaymentRecorded(uint256 indexed id, uint256 credited, uint256 totalPaid, bool fullyPaid);
    event DisputeOpened(uint256 indexed id, address indexed by, bytes32 reasonHash);
    event ModuleSet(address indexed module, bool enabled);
    event LateFeeParamsSet(uint16 bps, uint32 period, uint16 capBps, uint32 disputeWindow);

    error NotIssuer();
    error NotModule();
    error BadStatus(InvoiceStatus status);
    error BadParams();
    error BadSignature();
    error Expired();
    error WrongPayer();
    error DisputeWindowClosed();
    error NotParty();
    error NotYetDue();

    constructor(address owner_) Ownable(owner_) EIP712("Ledger", "1") {
        receivableNFT = new ReceivableNFT(address(this));
    }

    modifier onlyModule() {
        if (!isModule[msg.sender]) revert NotModule();
        _;
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setModule(address module, bool enabled) external onlyOwner {
        isModule[module] = enabled;
        emit ModuleSet(module, enabled);
    }

    function setLateFeeParams(uint16 bps_, uint32 period_, uint16 cap_, uint32 window_) external onlyOwner {
        if (period_ == 0 || cap_ > 2_000 || bps_ > cap_) revert BadParams();
        (lateFeeBps, lateFeePeriod, lateFeeCapBps, disputeWindow) = (bps_, period_, cap_, window_);
        emit LateFeeParamsSet(bps_, period_, cap_, window_);
    }

    // ───────────────────────────── Issuer ─────────────────────────────

    /// @param payer client wallet, or address(0) for an open invoice (first valid acceptor becomes payer)
    function createInvoice(address payer, bytes32 commitment, uint128 amount, uint64 dueDate)
        external
        returns (uint256 id)
    {
        if (amount == 0 || commitment == bytes32(0)) revert BadParams();
        if (dueDate < block.timestamp + MIN_TENOR || dueDate > block.timestamp + MAX_TENOR) revert BadParams();
        if (payer == msg.sender) revert WrongPayer();

        id = nextId++;
        Invoice storage inv = _invoices[id];
        inv.issuer = msg.sender;
        inv.payer = payer;
        inv.commitment = commitment;
        inv.amount = amount;
        inv.issuedAt = uint64(block.timestamp);
        inv.dueDate = dueDate;
        inv.status = InvoiceStatus.Issued;

        emit InvoiceCreated(id, msg.sender, payer, amount, dueDate, commitment);
    }

    function cancelInvoice(uint256 id) external {
        Invoice storage inv = _invoices[id];
        if (inv.issuer != msg.sender) revert NotIssuer();
        if (inv.status != InvoiceStatus.Issued) revert BadStatus(inv.status);
        inv.closedAt = uint64(block.timestamp);
        _setStatus(id, InvoiceStatus.Cancelled);
        emit InvoiceCancelled(id);
    }

    // ───────────────────────────── Client ─────────────────────────────

    /// @notice Gasless acceptance: anyone (e.g. the Ledger relayer) submits the payer's EIP-712 signature.
    function acceptInvoiceWithSig(uint256 id, address payer, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = acceptanceDigest(id, payer, deadline);
        if (!SignatureChecker.isValidSignatureNow(payer, digest, signature)) revert BadSignature();
        _accept(id, payer);
    }

    function acceptInvoice(uint256 id) external {
        _accept(id, msg.sender);
    }

    function acceptanceDigest(uint256 id, address payer, uint256 deadline) public view returns (bytes32) {
        Invoice storage inv = _invoices[id];
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ACCEPTANCE_TYPEHASH, id, inv.commitment, uint256(inv.amount), inv.dueDate, payer, deadline
                )
            )
        );
    }

    function _accept(uint256 id, address payer) internal {
        Invoice storage inv = _invoices[id];
        if (inv.status != InvoiceStatus.Issued) revert BadStatus(inv.status);
        if (payer == address(0) || payer == inv.issuer) revert WrongPayer();
        if (inv.payer == address(0)) inv.payer = payer;
        else if (inv.payer != payer) revert WrongPayer();
        if (block.timestamp >= inv.dueDate) revert Expired();

        inv.acceptedAt = uint64(block.timestamp);
        _setStatus(id, InvoiceStatus.Accepted);
        receivableNFT.mint(inv.issuer, id);
        emit InvoiceAccepted(id, payer);
    }

    // ───────────────────────────── Disputes / overdue ─────────────────────────────

    function openDispute(uint256 id, bytes32 reasonHash) external {
        Invoice storage inv = _invoices[id];
        if (msg.sender != inv.issuer && msg.sender != inv.payer) revert NotParty();
        InvoiceStatus s = inv.status;
        if (
            s != InvoiceStatus.Accepted && s != InvoiceStatus.Financed && s != InvoiceStatus.PartiallyPaid
                && s != InvoiceStatus.Overdue
        ) revert BadStatus(s);
        if (block.timestamp > uint256(inv.dueDate) + disputeWindow) revert DisputeWindowClosed();
        inv.statusBeforeDispute = s;
        _setStatus(id, InvoiceStatus.Disputed);
        emit DisputeOpened(id, msg.sender, reasonHash);
    }

    /// @notice Anyone can flag an unpaid invoice as overdue once past its due date.
    function markOverdue(uint256 id) external {
        Invoice storage inv = _invoices[id];
        InvoiceStatus s = inv.status;
        if (s != InvoiceStatus.Accepted && s != InvoiceStatus.Financed && s != InvoiceStatus.PartiallyPaid) {
            revert BadStatus(s);
        }
        if (block.timestamp <= inv.dueDate) revert NotYetDue();
        _setStatus(id, InvoiceStatus.Overdue);
    }

    // ───────────────────────────── Modules ─────────────────────────────

    function setStatus(uint256 id, InvoiceStatus status) external onlyModule {
        Invoice storage inv = _invoices[id];
        if (status == InvoiceStatus.Settled || status == InvoiceStatus.Defaulted) {
            inv.closedAt = uint64(block.timestamp);
        }
        _setStatus(id, status);
    }

    /// @notice Credit a payment. Marks Settled when face value + accrued late fee is covered.
    ///         For Defaulted invoices the status stays Defaulted (late recovery) but `paid` still accrues.
    function recordPayment(uint256 id, uint256 credited) external onlyModule returns (bool fullyPaid) {
        Invoice storage inv = _invoices[id];
        uint256 owedBefore = amountOwed(id);
        uint256 newPaid = uint256(inv.paid) + credited;
        inv.paid = SafeCast.toUint128(newPaid);
        fullyPaid = credited >= owedBefore;
        InvoiceStatus s = inv.status;
        if (fullyPaid) {
            if (s != InvoiceStatus.Defaulted) {
                inv.closedAt = uint64(block.timestamp);
                _setStatus(id, InvoiceStatus.Settled);
            }
        } else if (s == InvoiceStatus.Accepted || s == InvoiceStatus.Financed) {
            _setStatus(id, InvoiceStatus.PartiallyPaid);
        }
        emit PaymentRecorded(id, credited, newPaid, fullyPaid);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getInvoice(uint256 id) external view returns (Invoice memory) {
        return _invoices[id];
    }

    function receivable() external view returns (address) {
        return address(receivableNFT);
    }

    /// @notice Late fee accrued so far (frozen once the invoice is closed).
    function lateFee(uint256 id) public view returns (uint256) {
        Invoice storage inv = _invoices[id];
        uint256 end = (inv.closedAt != 0 && inv.status != InvoiceStatus.Defaulted) ? inv.closedAt : block.timestamp;
        if (inv.dueDate == 0 || end <= inv.dueDate) return 0;
        uint256 periods = (end - inv.dueDate + lateFeePeriod - 1) / lateFeePeriod;
        uint256 rate = LedgerMath.min(periods * lateFeeBps, lateFeeCapBps);
        return uint256(inv.amount).bps(rate);
    }

    /// @notice Remaining amount (face + late fee - paid). Zero once fully paid.
    function amountOwed(uint256 id) public view returns (uint256) {
        Invoice storage inv = _invoices[id];
        uint256 total = uint256(inv.amount) + lateFee(id);
        return total > inv.paid ? total - inv.paid : 0;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice On-chain metadata: only non-sensitive fields (no names, no line items).
    function tokenURIFor(uint256 id) external view returns (string memory) {
        Invoice storage inv = _invoices[id];
        string memory json = string.concat(
            '{"name":"Ledger Receivable #',
            Strings.toString(id),
            '","description":"Client-accepted invoice receivable on Mezo. Terms are encrypted off-chain.",',
            '"attributes":[{"trait_type":"Amount (MUSD)","value":',
            Strings.toString(uint256(inv.amount) / 1e18),
            '},{"trait_type":"Due","display_type":"date","value":',
            Strings.toString(inv.dueDate),
            '},{"trait_type":"Status","value":',
            Strings.toString(uint256(inv.status)),
            '},{"trait_type":"Commitment","value":"',
            Strings.toHexString(uint256(inv.commitment), 32),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _setStatus(uint256 id, InvoiceStatus to) internal {
        Invoice storage inv = _invoices[id];
        InvoiceStatus from = inv.status;
        inv.status = to;
        emit InvoiceStatusChanged(id, from, to);
    }
}
