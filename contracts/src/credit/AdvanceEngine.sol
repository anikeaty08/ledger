// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Invoice, InvoiceStatus, LedgerMath} from "../libraries/Types.sol";
import {
    IInvoiceRegistry,
    ICreditPolicy,
    ITrancheVault,
    IAdvanceEngine,
    IBTCSwapper
} from "../interfaces/ILedger.sol";

/// @title AdvanceEngine
/// @notice Funds MUSD advances against accepted receivables (recourse factoring) and runs the
///         repayment / default / recovery waterfall across the senior and junior tranches.
///
///   Funding   : each advance is funded 80% senior / 20% junior (junior subordination per advance).
///   Repayment : senior principal → junior principal → senior fee → junior fee → protocol fee.
///   Default   : recourse collateral is seized and applied senior-first; the junior tranche absorbs
///               the first loss. Later payments by the client are recovered senior-first, then junior,
///               and anything beyond the losses goes back to the freelancer.
contract AdvanceEngine is IAdvanceEngine, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using LedgerMath for uint256;
    using SafeCast for uint256;

    struct Advance {
        address borrower;
        address payer;
        uint128 principal; // original amount advanced
        uint128 fee; // original total discount fee
        uint128 seniorPrincipalDue;
        uint128 juniorPrincipalDue;
        uint128 seniorFeeDue;
        uint128 juniorFeeDue;
        uint128 protocolFeeDue;
        uint128 recourseMUSD;
        uint128 recourseBTC;
        uint128 seniorLoss; // outstanding loss after default (recoverable)
        uint128 juniorLoss;
        uint64 fundedAt;
        uint16 advanceRateBps;
        uint16 feePer30dBps;
        bool active;
        bool defaulted;
    }

    IERC20 public immutable musd;
    IInvoiceRegistry public immutable registry;
    IERC721 public immutable receivables;
    ITrancheVault public immutable senior;
    ITrancheVault public immutable junior;

    ICreditPolicy public policy;
    IBTCSwapper public swapper;
    address public router;
    address public collections;
    address public treasury;

    // Parameters
    uint16 public juniorShareBps = 2_000; // share of each advance funded by junior
    uint16 public juniorFeeShareBps = 3_000; // share of LP fees paid to junior
    uint16 public protocolFeeBps = 1_500; // protocol cut of each discount fee
    uint16 public btcRecourseHaircutBps = 8_000; // BTC recourse counted at 80% of oracle value
    uint16 public payerExposureTvlBps = 1_000; // max 10% of total TVL per client
    uint16 public maxDefaultRateBps = 500; // circuit breaker: 5% of window volume
    uint64 public minTenor = 7 days;
    uint64 public maxTenor = 120 days;
    uint128 public minAdvance = 10e18;
    uint128 public maxPayerExposure = 25_000e18;
    uint32 public maxOpenPerBorrower = 5;
    uint64 public riskWindow = 30 days;

    mapping(uint256 => Advance) internal _advances;
    mapping(address => uint256) public payerExposure;
    mapping(address => uint256) public openAdvances;
    uint256 public totalOutstanding;
    uint256 public protocolFeesAccrued;

    // Circuit-breaker window
    uint64 public windowStart;
    uint256 public windowFunded;
    uint256 public windowDefaulted;

    event AdvanceFunded(
        uint256 indexed invoiceId,
        address indexed borrower,
        address indexed payer,
        uint256 principal,
        uint256 fee,
        uint256 recourseMUSD,
        uint256 recourseBTC
    );
    event PaymentApplied(uint256 indexed invoiceId, uint256 principalPaid, uint256 feePaid, uint256 leftover);
    event AdvanceClosed(uint256 indexed invoiceId);
    event AdvanceDefaulted(uint256 indexed invoiceId, uint256 recovered, uint256 seniorLoss, uint256 juniorLoss);
    event RecoveryApplied(uint256 indexed invoiceId, uint256 toSenior, uint256 toJunior, uint256 leftover);
    event CircuitBreakerTripped(uint256 funded, uint256 defaulted);
    event ModulesSet(address router, address collections, address policy, address swapper, address treasury);
    event ProtocolFeesWithdrawn(address to, uint256 amount);

    error NotRouter();
    error NotCollections();
    error NotIssuer();
    error BadStatus(InvoiceStatus status);
    error BadTenor();
    error Ineligible();
    error TooLarge(uint256 max);
    error TooSmall();
    error FeeTooHigh(uint256 fee);
    error InsufficientRecourse(uint256 required, uint256 provided);
    error ExposureCap();
    error TooManyOpen();
    error NotActive();
    error InsufficientVaultLiquidity();
    error BadParams();

    constructor(
        address owner_,
        IERC20 musd_,
        IInvoiceRegistry registry_,
        ITrancheVault senior_,
        ITrancheVault junior_,
        ICreditPolicy policy_,
        IBTCSwapper swapper_
    ) Ownable(owner_) {
        musd = musd_;
        registry = registry_;
        receivables = IERC721(registry_.receivable());
        senior = senior_;
        junior = junior_;
        policy = policy_;
        swapper = swapper_;
        treasury = owner_;
        windowStart = uint64(block.timestamp);
    }

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    modifier onlyCollections() {
        if (msg.sender != collections) revert NotCollections();
        _;
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setModules(address router_, address collections_, ICreditPolicy policy_, IBTCSwapper swapper_, address treasury_)
        external
        onlyOwner
    {
        (router, collections, policy, swapper, treasury) = (router_, collections_, policy_, swapper_, treasury_);
        emit ModulesSet(router_, collections_, address(policy_), address(swapper_), treasury_);
    }

    function setParams(
        uint16 juniorShareBps_,
        uint16 juniorFeeShareBps_,
        uint16 protocolFeeBps_,
        uint16 btcHaircutBps_,
        uint16 payerExposureTvlBps_,
        uint16 maxDefaultRateBps_
    ) external onlyOwner {
        if (
            juniorShareBps_ > 10_000 || juniorFeeShareBps_ > 10_000 || protocolFeeBps_ > 5_000
                || btcHaircutBps_ > 10_000 || payerExposureTvlBps_ > 10_000
        ) revert BadParams();
        juniorShareBps = juniorShareBps_;
        juniorFeeShareBps = juniorFeeShareBps_;
        protocolFeeBps = protocolFeeBps_;
        btcRecourseHaircutBps = btcHaircutBps_;
        payerExposureTvlBps = payerExposureTvlBps_;
        maxDefaultRateBps = maxDefaultRateBps_;
    }

    function setLimits(
        uint64 minTenor_,
        uint64 maxTenor_,
        uint128 minAdvance_,
        uint128 maxPayerExposure_,
        uint32 maxOpen_,
        uint64 riskWindow_
    ) external onlyOwner {
        if (minTenor_ == 0 || maxTenor_ < minTenor_ || riskWindow_ == 0) revert BadParams();
        (minTenor, maxTenor, minAdvance, maxPayerExposure, maxOpenPerBorrower, riskWindow) =
            (minTenor_, maxTenor_, minAdvance_, maxPayerExposure_, maxOpen_, riskWindow_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
        _rollWindow(true);
    }

    function withdrawProtocolFees(address to) external onlyOwner {
        uint256 amount = protocolFeesAccrued;
        protocolFeesAccrued = 0;
        musd.safeTransfer(to, amount);
        emit ProtocolFeesWithdrawn(to, amount);
    }

    // ───────────────────────────── Quotes ─────────────────────────────

    struct Quote {
        bool eligible;
        uint256 maxAdvance;
        uint256 feeForMax;
        uint16 advanceRateBps;
        uint16 feePer30dBps;
        uint16 recourseBps;
        uint256 tenorDays;
    }

    function quote(uint256 invoiceId) public view returns (Quote memory q) {
        Invoice memory inv = registry.getInvoice(invoiceId);
        if (inv.status != InvoiceStatus.Accepted || block.timestamp >= inv.dueDate) return q;
        uint256 tenor = inv.dueDate - block.timestamp;
        if (tenor < minTenor || tenor > maxTenor) return q;

        ICreditPolicy.Terms memory t = policy.terms(inv.payer, inv.issuer);
        if (!t.eligible) return q;

        q.eligible = true;
        q.advanceRateBps = t.advanceRateBps;
        q.feePer30dBps = t.feePer30dBps;
        q.recourseBps = t.recourseBps;
        q.tenorDays = (tenor + 1 days - 1) / 1 days;

        uint256 byRate = uint256(inv.amount).bps(t.advanceRateBps);
        uint256 byExposure = _exposureHeadroom(inv.payer);
        uint256 byLiquidity = _liquidityCap();
        q.maxAdvance = LedgerMath.min(byRate, LedgerMath.min(byExposure, byLiquidity));
        q.feeForMax = feeFor(q.maxAdvance, t.feePer30dBps, tenor);
        // advance + fee must fit inside the face value
        if (q.maxAdvance + q.feeForMax > inv.amount) {
            q.maxAdvance = (uint256(inv.amount) * 10_000) / (10_000 + _periods(tenor) * t.feePer30dBps);
            q.feeForMax = feeFor(q.maxAdvance, t.feePer30dBps, tenor);
        }
    }

    function feeFor(uint256 amount, uint256 feePer30dBps, uint256 tenor) public pure returns (uint256) {
        return amount.bpsUp(feePer30dBps * _periods(tenor));
    }

    function recourseRequired(uint256 amount, uint16 recourseBps) public pure returns (uint256) {
        return amount.bpsUp(recourseBps);
    }

    // ───────────────────────────── Borrow ─────────────────────────────

    /// @notice Take an advance against an accepted invoice. Caller must be the issuer and hold the NFT
    ///         (approved to this contract). BTC recourse is attached as msg.value.
    function requestAdvance(uint256 invoiceId, uint256 amount, uint256 maxFee, uint256 recourseMUSD)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        _rollWindow(false);
        Invoice memory inv = registry.getInvoice(invoiceId);
        if (inv.status != InvoiceStatus.Accepted) revert BadStatus(inv.status);
        if (inv.issuer != msg.sender || receivables.ownerOf(invoiceId) != msg.sender) revert NotIssuer();
        if (openAdvances[msg.sender] >= maxOpenPerBorrower) revert TooManyOpen();

        Quote memory q = quote(invoiceId);
        if (!q.eligible) revert Ineligible();
        if (amount < minAdvance) revert TooSmall();
        if (amount > q.maxAdvance) revert TooLarge(q.maxAdvance);

        uint256 tenor = inv.dueDate - block.timestamp;
        uint256 fee = feeFor(amount, q.feePer30dBps, tenor);
        if (fee > maxFee) revert FeeTooHigh(fee);
        if (amount + fee > inv.amount) revert TooLarge(q.maxAdvance);

        // Recourse collateral (MUSD + haircut BTC value) must cover the tier requirement.
        uint256 required = recourseRequired(amount, q.recourseBps);
        uint256 provided = recourseMUSD;
        if (msg.value > 0) provided += swapper.btcValue(msg.value).bps(btcRecourseHaircutBps);
        if (provided < required) revert InsufficientRecourse(required, provided);
        if (recourseMUSD > 0) musd.safeTransferFrom(msg.sender, address(this), recourseMUSD);

        _book(invoiceId, inv.payer, amount, fee, recourseMUSD, msg.value, q);

        // Fund from the tranches.
        uint256 juniorPart = amount.bps(juniorShareBps);
        uint256 seniorPart = amount - juniorPart;
        if (seniorPart > 0) senior.fund(seniorPart);
        if (juniorPart > 0) junior.fund(juniorPart);

        receivables.transferFrom(msg.sender, address(this), invoiceId);
        registry.setStatus(invoiceId, InvoiceStatus.Financed);
        musd.safeTransfer(msg.sender, amount);

        emit AdvanceFunded(invoiceId, msg.sender, inv.payer, amount, fee, recourseMUSD, msg.value);
    }

    function _book(
        uint256 invoiceId,
        address payer,
        uint256 amount,
        uint256 fee,
        uint256 recourseMUSD,
        uint256 recourseBTC,
        Quote memory q
    ) internal {
        uint256 juniorPart = amount.bps(juniorShareBps);
        uint256 protocolFee = fee.bps(protocolFeeBps);
        uint256 lpFee = fee - protocolFee;
        uint256 juniorFee = lpFee.bps(juniorFeeShareBps);

        Advance storage a = _advances[invoiceId];
        a.borrower = msg.sender;
        a.payer = payer;
        a.principal = (amount).toUint128();
        a.fee = (fee).toUint128();
        a.seniorPrincipalDue = (amount - juniorPart).toUint128();
        a.juniorPrincipalDue = (juniorPart).toUint128();
        a.seniorFeeDue = (lpFee - juniorFee).toUint128();
        a.juniorFeeDue = (juniorFee).toUint128();
        a.protocolFeeDue = (protocolFee).toUint128();
        a.recourseMUSD = (recourseMUSD).toUint128();
        a.recourseBTC = (recourseBTC).toUint128();
        a.fundedAt = uint64(block.timestamp);
        a.advanceRateBps = q.advanceRateBps;
        a.feePer30dBps = q.feePer30dBps;
        a.active = true;

        payerExposure[payer] += amount;
        openAdvances[msg.sender] += 1;
        totalOutstanding += amount;
        windowFunded += amount;
    }

    // ───────────────────────────── Router hooks ─────────────────────────────

    /// @notice Router transferred `amount` MUSD to this contract; take what the vaults are owed and
    ///         return the leftover to the router.
    function applyPayment(uint256 invoiceId, uint256 amount)
        external
        onlyRouter
        nonReentrant
        returns (uint256 toVaults)
    {
        Advance storage a = _advances[invoiceId];
        if (!a.active) revert NotActive();
        uint256 left = amount;

        uint256 sP = LedgerMath.min(left, a.seniorPrincipalDue);
        left -= sP;
        uint256 jP = LedgerMath.min(left, a.juniorPrincipalDue);
        left -= jP;
        uint256 sF = LedgerMath.min(left, a.seniorFeeDue);
        left -= sF;
        uint256 jF = LedgerMath.min(left, a.juniorFeeDue);
        left -= jF;
        uint256 pF = LedgerMath.min(left, a.protocolFeeDue);
        left -= pF;

        a.seniorPrincipalDue -= uint128(sP);
        a.juniorPrincipalDue -= uint128(jP);
        a.seniorFeeDue -= uint128(sF);
        a.juniorFeeDue -= uint128(jF);
        a.protocolFeeDue -= uint128(pF);
        protocolFeesAccrued += pF;
        totalOutstanding -= (sP + jP);
        _reduceExposure(a, sP + jP);

        if (sP + sF > 0) {
            musd.safeTransfer(address(senior), sP + sF);
            senior.onRepay(sP, sF);
        }
        if (jP + jF > 0) {
            musd.safeTransfer(address(junior), jP + jF);
            junior.onRepay(jP, jF);
        }
        if (left > 0) musd.safeTransfer(router, left);

        toVaults = amount - left;
        emit PaymentApplied(invoiceId, sP + jP, sF + jF + pF, left);
    }

    /// @notice Invoice fully settled: release recourse and return the receivable NFT to the borrower.
    function closeOnSettlement(uint256 invoiceId) external onlyRouter nonReentrant {
        Advance storage a = _advances[invoiceId];
        if (!a.active) revert NotActive();
        // Any fee shortfall (e.g. invoice paid exactly face value on a max-size advance) is waived for the
        // protocol cut first; LP dues must be zero here because advance + fee ≤ face value.
        a.protocolFeeDue = 0;
        a.active = false;
        openAdvances[a.borrower] -= 1;
        _reduceExposure(a, a.seniorPrincipalDue + a.juniorPrincipalDue);

        uint256 rM = a.recourseMUSD;
        uint256 rB = a.recourseBTC;
        a.recourseMUSD = 0;
        a.recourseBTC = 0;

        receivables.transferFrom(address(this), a.borrower, invoiceId);
        if (rM > 0) musd.safeTransfer(a.borrower, rM);
        if (rB > 0) Address.sendValue(payable(a.borrower), rB);
        emit AdvanceClosed(invoiceId);
    }

    // ───────────────────────────── Default & recovery ─────────────────────────────

    function onDefault(uint256 invoiceId) external onlyCollections nonReentrant {
        Advance storage a = _advances[invoiceId];
        if (!a.active) revert NotActive();
        a.active = false;
        a.defaulted = true;
        openAdvances[a.borrower] -= 1;

        // Seize recourse.
        uint256 recovered = a.recourseMUSD;
        a.recourseMUSD = 0;
        if (a.recourseBTC > 0) {
            uint256 btc = a.recourseBTC;
            a.recourseBTC = 0;
            recovered += swapper.swapBTCForMUSD{value: btc}(0, address(this));
        }

        uint256 principalOutstanding = uint256(a.seniorPrincipalDue) + a.juniorPrincipalDue;
        uint256 sP = LedgerMath.min(recovered, a.seniorPrincipalDue);
        uint256 jP = LedgerMath.min(recovered - sP, a.juniorPrincipalDue);
        uint256 left = recovered - sP - jP;
        uint256 sF = LedgerMath.min(left, a.seniorFeeDue);
        left -= sF;
        uint256 jF = LedgerMath.min(left, a.juniorFeeDue);
        left -= jF;

        uint256 sLoss = a.seniorPrincipalDue - sP;
        uint256 jLoss = a.juniorPrincipalDue - jP;
        a.seniorLoss = uint128(sLoss);
        a.juniorLoss = uint128(jLoss);
        a.seniorPrincipalDue = 0;
        a.juniorPrincipalDue = 0;
        a.seniorFeeDue = 0;
        a.juniorFeeDue = 0;
        a.protocolFeeDue = 0;

        totalOutstanding -= principalOutstanding;
        _reduceExposure(a, principalOutstanding);
        windowDefaulted += sLoss + jLoss;

        if (sP + sF > 0) {
            musd.safeTransfer(address(senior), sP + sF);
            senior.onRepay(sP, sF);
        }
        if (jP + jF > 0) {
            musd.safeTransfer(address(junior), jP + jF);
            junior.onRepay(jP, jF);
        }
        if (sLoss > 0) senior.onLoss(sLoss);
        if (jLoss > 0) junior.onLoss(jLoss);
        if (left > 0) musd.safeTransfer(a.borrower, left); // over-collateralized recourse returns

        // If recourse alone fully covered the loss, there's nothing left to recover later — release
        // the receivable now instead of leaving it stranded in this contract with no future call that
        // would ever move it (applyRecovery only runs while recoveryDue() > 0).
        if (sLoss == 0 && jLoss == 0) {
            receivables.transferFrom(address(this), a.borrower, invoiceId);
        }

        emit AdvanceDefaulted(invoiceId, recovered, sLoss, jLoss);
        _checkCircuitBreaker();
    }

    /// @notice Late payment on a defaulted, financed invoice. Router transferred `amount` MUSD first.
    function applyRecovery(uint256 invoiceId, uint256 amount)
        external
        onlyRouter
        nonReentrant
        returns (uint256 toVaults)
    {
        Advance storage a = _advances[invoiceId];
        uint256 toS = LedgerMath.min(amount, a.seniorLoss);
        uint256 toJ = LedgerMath.min(amount - toS, a.juniorLoss);
        a.seniorLoss -= uint128(toS);
        a.juniorLoss -= uint128(toJ);
        uint256 left = amount - toS - toJ;

        if (toS > 0) {
            musd.safeTransfer(address(senior), toS);
            senior.onRecovery(toS);
        }
        if (toJ > 0) {
            musd.safeTransfer(address(junior), toJ);
            junior.onRecovery(toJ);
        }
        if (left > 0) musd.safeTransfer(router, left);
        toVaults = toS + toJ;

        // The loss is now fully recovered — release the receivable rather than leave it stranded
        // (see the matching comment in onDefault for why this can't just wait for a later call).
        if (a.seniorLoss == 0 && a.juniorLoss == 0) {
            receivables.transferFrom(address(this), a.borrower, invoiceId);
        }

        emit RecoveryApplied(invoiceId, toS, toJ, left);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getAdvance(uint256 invoiceId) external view returns (Advance memory) {
        return _advances[invoiceId];
    }

    function hasActiveAdvance(uint256 invoiceId) external view returns (bool) {
        return _advances[invoiceId].active;
    }

    function borrowerOf(uint256 invoiceId) external view returns (address) {
        return _advances[invoiceId].borrower;
    }

    function vaultDue(uint256 invoiceId) public view returns (uint256) {
        Advance storage a = _advances[invoiceId];
        if (!a.active) return 0;
        return uint256(a.seniorPrincipalDue) + a.juniorPrincipalDue + a.seniorFeeDue + a.juniorFeeDue
            + a.protocolFeeDue;
    }

    function recoveryDue(uint256 invoiceId) external view returns (uint256) {
        Advance storage a = _advances[invoiceId];
        return uint256(a.seniorLoss) + a.juniorLoss;
    }

    function totalTVL() public view returns (uint256) {
        return senior.totalAssets() + junior.totalAssets();
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _periods(uint256 tenor) internal pure returns (uint256) {
        uint256 p = (tenor + 30 days - 1) / 30 days;
        return p == 0 ? 1 : p;
    }

    function _exposureHeadroom(address payer) internal view returns (uint256) {
        uint256 cap = LedgerMath.min(maxPayerExposure, totalTVL().bps(payerExposureTvlBps));
        uint256 used = payerExposure[payer];
        return cap > used ? cap - used : 0;
    }

    /// @dev Largest advance the tranches can fund given the 80/20 split.
    function _liquidityCap() internal view returns (uint256) {
        uint256 s = senior.availableLiquidity();
        uint256 j = junior.availableLiquidity();
        uint256 bySenior = juniorShareBps == 10_000 ? type(uint256).max : (s * 10_000) / (10_000 - juniorShareBps);
        uint256 byJunior = juniorShareBps == 0 ? type(uint256).max : (j * 10_000) / juniorShareBps;
        return LedgerMath.min(bySenior, byJunior);
    }

    function _reduceExposure(Advance storage a, uint256 amount) internal {
        uint256 e = payerExposure[a.payer];
        payerExposure[a.payer] = e > amount ? e - amount : 0;
    }

    function _rollWindow(bool force) internal {
        if (force || block.timestamp >= windowStart + riskWindow) {
            windowStart = uint64(block.timestamp);
            windowFunded = 0;
            windowDefaulted = 0;
        }
    }

    function _checkCircuitBreaker() internal {
        uint256 base = LedgerMath.max(windowFunded, totalTVL());
        if (base > 0 && windowDefaulted * 10_000 > base * maxDefaultRateBps && !paused()) {
            _pause();
            emit CircuitBreakerTripped(windowFunded, windowDefaulted);
        }
    }

    receive() external payable {
        // accepts BTC only as refunds from the swapper path; recourse BTC arrives via requestAdvance
    }
}
