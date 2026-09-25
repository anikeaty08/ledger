// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Invoice, InvoiceStatus, LedgerMath} from "../libraries/Types.sol";
import {
    IInvoiceRegistry,
    IAdvanceEngine,
    IReputationRegistry,
    IBTCSwapper,
    ILedgerAccount,
    ILedgerAccountFactory,
    ISplitter
} from "../interfaces/ILedger.sol";

/// @title SettlementRouter
/// @notice The only way an invoice gets paid. Every payment runs the same waterfall:
///           1. financed invoice → AdvanceEngine takes vault principal + fees
///           2. defaulted invoice → AdvanceEngine recovers tranche losses
///           3. remainder → payee preference: Splitter | LedgerAccount (treasury) | wallet
///         BTC payments are valued with Mezo's PriceFeed and either swapped to MUSD on Mezo Pools, or —
///         when the payee opted into Keep-BTC — deposited as collateral into the payee's MUSD position.
contract SettlementRouter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PayoutPrefs {
        address splitter; // if set, remainders are distributed by this splitter
        bool toAccount; // else, send to the payee's LedgerAccount (treasury rules apply)
        bool keepBTC; // BTC payments become collateral in the payee's MUSD position
        uint16 targetCRBps; // collateral ratio used when minting against kept BTC (e.g. 25000 = 250%)
    }

    IERC20 public immutable musd;
    IInvoiceRegistry public immutable registry;
    IERC721 public immutable receivables;
    IAdvanceEngine public immutable engine;
    IReputationRegistry public immutable reputation;
    IBTCSwapper public swapper;
    ILedgerAccountFactory public accountFactory;

    uint16 public constant MIN_TARGET_CR_BPS = 20_000; // 200%
    uint16 public constant MAX_TARGET_CR_BPS = 40_000; // 400%

    mapping(address => PayoutPrefs) public prefs;

    event PayoutPrefsSet(address indexed who, address splitter, bool toAccount, bool keepBTC, uint16 targetCRBps);
    event InvoicePaid(
        uint256 indexed invoiceId,
        address indexed from,
        bool inBTC,
        uint256 btcAmount,
        uint256 credited,
        uint256 toVaults,
        uint256 remainder
    );
    event KeptBTC(uint256 indexed invoiceId, address indexed account, uint256 btcAmount, uint256 musdMinted);
    event Payout(address indexed payee, address indexed destination, uint256 amount);
    event ModulesSet(address indexed swapper, address indexed accountFactory);

    error NotPayable(InvoiceStatus status);
    error NothingOwed();
    error ZeroAmount();
    error BadPrefs();

    constructor(
        address owner_,
        IERC20 musd_,
        IInvoiceRegistry registry_,
        IAdvanceEngine engine_,
        IReputationRegistry reputation_,
        IBTCSwapper swapper_,
        ILedgerAccountFactory accountFactory_
    ) Ownable(owner_) {
        musd = musd_;
        registry = registry_;
        receivables = IERC721(registry_.receivable());
        engine = engine_;
        reputation = reputation_;
        swapper = swapper_;
        accountFactory = accountFactory_;
    }

    function setModules(IBTCSwapper swapper_, ILedgerAccountFactory accountFactory_) external onlyOwner {
        swapper = swapper_;
        accountFactory = accountFactory_;
        emit ModulesSet(address(swapper_), address(accountFactory_));
    }

    function setPayoutPrefs(address splitter, bool toAccount, bool keepBTC, uint16 targetCRBps) external {
        if (keepBTC && (targetCRBps < MIN_TARGET_CR_BPS || targetCRBps > MAX_TARGET_CR_BPS)) revert BadPrefs();
        if ((keepBTC || toAccount) && accountFactory.accountOf(msg.sender) == address(0)) revert BadPrefs();
        prefs[msg.sender] = PayoutPrefs(splitter, toAccount, keepBTC, targetCRBps);
        emit PayoutPrefsSet(msg.sender, splitter, toAccount, keepBTC, targetCRBps);
    }

    // ───────────────────────────── Pay ─────────────────────────────

    /// @notice Pay an invoice in MUSD. Anyone may pay; reputation is credited to the invoice's payer.
    ///         Over-payment is capped to the amount owed.
    function pay(uint256 invoiceId, uint256 amount) external nonReentrant returns (uint256 used) {
        if (amount == 0) revert ZeroAmount();
        Invoice memory inv = registry.getInvoice(invoiceId);
        _checkPayable(inv.status);
        uint256 owed = registry.amountOwed(invoiceId);
        if (owed == 0) revert NothingOwed();
        used = amount > owed ? owed : amount;
        musd.safeTransferFrom(msg.sender, address(this), used);
        _settle(invoiceId, inv, used, used, false, 0);
    }

    /// @notice Pay an invoice in native BTC. Credited at the Mezo oracle value.
    /// @param minMUSDOut floor for the swap path (ignored on the Keep-BTC path)
    function payWithBTC(uint256 invoiceId, uint256 minMUSDOut) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        Invoice memory inv = registry.getInvoice(invoiceId);
        _checkPayable(inv.status);
        if (registry.amountOwed(invoiceId) == 0) revert NothingOwed();

        uint256 value = swapper.btcValue(msg.value);
        address payee = _payee(invoiceId, inv);
        PayoutPrefs memory p = prefs[payee];

        if (p.keepBTC && inv.status != InvoiceStatus.Defaulted) {
            address account = accountFactory.accountOf(payee);
            if (account != address(0)) {
                uint256 due = engine.hasActiveAdvance(invoiceId) ? engine.vaultDue(invoiceId) : 0;
                uint256 debt = LedgerMath.max((value * 10_000) / p.targetCRBps, due);
                try ILedgerAccount(account).borrowAgainstBTC{value: msg.value}(debt, address(0), address(0)) returns (
                    uint256 minted
                ) {
                    emit KeptBTC(invoiceId, account, msg.value, minted);
                    _settle(invoiceId, inv, minted, value, true, msg.value);
                    return;
                } catch {
                    // fall through to the swap path (e.g. below MUSD minimum debt)
                }
            }
        }

        uint256 out = swapper.swapBTCForMUSD{value: msg.value}(minMUSDOut, address(this));
        _settle(invoiceId, inv, out, out, true, msg.value);
    }

    // ───────────────────────────── Waterfall ─────────────────────────────

    function _settle(
        uint256 invoiceId,
        Invoice memory inv,
        uint256 musdIn,
        uint256 credited,
        bool inBTC,
        uint256 btcAmount
    ) internal {
        uint256 toVaults;
        if (engine.hasActiveAdvance(invoiceId)) {
            musd.safeTransfer(address(engine), musdIn);
            toVaults = engine.applyPayment(invoiceId, musdIn);
        } else if (inv.status == InvoiceStatus.Defaulted && engine.recoveryDue(invoiceId) > 0) {
            musd.safeTransfer(address(engine), musdIn);
            toVaults = engine.applyRecovery(invoiceId, musdIn);
        }

        bool fullyPaid = registry.recordPayment(invoiceId, credited);
        if (fullyPaid && inv.status != InvoiceStatus.Defaulted) {
            uint256 daysLate = block.timestamp > inv.dueDate ? (block.timestamp - inv.dueDate) / 1 days : 0;
            reputation.recordSettlement(inv.payer, inv.issuer, inv.amount, daysLate);
            if (engine.hasActiveAdvance(invoiceId)) engine.closeOnSettlement(invoiceId);
        }

        uint256 remainder = musdIn - toVaults;
        if (remainder > 0) _payout(_payee(invoiceId, inv), remainder);
        emit InvoicePaid(invoiceId, msg.sender, inBTC, btcAmount, credited, toVaults, remainder);
    }

    function _payout(address payee, uint256 amount) internal {
        PayoutPrefs memory p = prefs[payee];
        address dest = payee;
        if (p.splitter != address(0)) {
            dest = p.splitter;
            musd.safeTransfer(dest, amount);
            ISplitter(dest).distribute(address(musd));
        } else if (p.toAccount) {
            address account = accountFactory.accountOf(payee);
            dest = account == address(0) ? payee : account;
            musd.safeTransfer(dest, amount);
            if (account != address(0)) ILedgerAccount(account).onIncome(amount);
        } else {
            musd.safeTransfer(dest, amount);
        }
        emit Payout(payee, dest, amount);
    }

    /// @dev Proceeds follow the receivable: the NFT holder, or the borrower while the engine holds it.
    function _payee(uint256 invoiceId, Invoice memory inv) internal view returns (address) {
        address holder = receivables.ownerOf(invoiceId);
        if (holder == address(engine)) {
            address b = engine.borrowerOf(invoiceId);
            return b == address(0) ? inv.issuer : b;
        }
        return holder;
    }

    function _checkPayable(InvoiceStatus s) internal pure {
        if (
            s != InvoiceStatus.Accepted && s != InvoiceStatus.Financed && s != InvoiceStatus.PartiallyPaid
                && s != InvoiceStatus.Overdue && s != InvoiceStatus.Disputed && s != InvoiceStatus.Defaulted
        ) revert NotPayable(s);
    }

    /// @notice Quote how a payment of `amount` MUSD would be split right now.
    function previewPayment(uint256 invoiceId, uint256 amount)
        external
        view
        returns (uint256 used, uint256 toVaults, uint256 remainder)
    {
        uint256 owed = registry.amountOwed(invoiceId);
        used = amount > owed ? owed : amount;
        uint256 due = engine.hasActiveAdvance(invoiceId) ? engine.vaultDue(invoiceId) : engine.recoveryDue(invoiceId);
        toVaults = used > due ? due : used;
        remainder = used - toVaults;
    }
}
