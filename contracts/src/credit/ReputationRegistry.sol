// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title ReputationRegistry
/// @notice Portable, on-chain payment reputation for clients (payers) and freelancers (issuers).
///         Only settlement/collections modules can write. The score is transparent and deterministic:
///
///           score = onTimeRate × volumeFactor × diversityFactor − 250 × defaults     (clamped to 0..1000)
///
///         - onTimeRate:     on-time settlements / total settlements        (0..1000)
///         - volumeFactor:   log10(total MUSD paid) / 5, saturates at 100k MUSD (0..1000)
///         - diversityFactor: distinct issuers paid × 250, saturates at 4    (0..1000)
///         Diversity weighting makes wash-trading with a single self-controlled issuer ineffective.
contract ReputationRegistry is Ownable2Step {
    struct PayerStats {
        uint32 settled;
        uint32 onTime;
        uint32 late;
        uint32 defaults;
        uint32 distinctIssuers;
        uint128 volume; // MUSD, 1e18
        uint64 lastUpdate;
    }

    struct IssuerStats {
        uint32 invoicesSettled;
        uint32 faults; // disputes resolved against the issuer / off-router diversion
        uint128 volume;
        uint64 lastUpdate;
    }

    uint256 public constant MAX_SCORE = 1000;
    uint256 public onTimeGraceDays = 3;

    mapping(address => PayerStats) public payers;
    mapping(address => IssuerStats) public issuers;
    mapping(address => mapping(address => bool)) public hasPaidIssuer;
    mapping(address => bool) public isWriter;

    event WriterSet(address indexed writer, bool enabled);
    event SettlementRecorded(address indexed payer, address indexed issuer, uint256 amount, uint256 daysLate);
    event PayerDefaultRecorded(address indexed payer, address indexed issuer, uint256 amount);
    event IssuerFaultRecorded(address indexed issuer, uint256 amount);
    event ScoreUpdated(address indexed payer, uint256 score);

    error NotWriter();

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyWriter() {
        if (!isWriter[msg.sender]) revert NotWriter();
        _;
    }

    function setWriter(address writer, bool enabled) external onlyOwner {
        isWriter[writer] = enabled;
        emit WriterSet(writer, enabled);
    }

    function setOnTimeGraceDays(uint256 d) external onlyOwner {
        onTimeGraceDays = d;
    }

    function recordSettlement(address payer, address issuer, uint256 amount, uint256 daysLate) external onlyWriter {
        PayerStats storage p = payers[payer];
        p.settled += 1;
        if (daysLate <= onTimeGraceDays) p.onTime += 1;
        else p.late += 1;
        p.volume += SafeCast.toUint128(amount);
        p.lastUpdate = uint64(block.timestamp);
        if (!hasPaidIssuer[payer][issuer]) {
            hasPaidIssuer[payer][issuer] = true;
            p.distinctIssuers += 1;
        }

        IssuerStats storage i = issuers[issuer];
        i.invoicesSettled += 1;
        i.volume += SafeCast.toUint128(amount);
        i.lastUpdate = uint64(block.timestamp);

        emit SettlementRecorded(payer, issuer, amount, daysLate);
        emit ScoreUpdated(payer, clientScore(payer));
    }

    function recordPayerDefault(address payer, address issuer, uint256 amount) external onlyWriter {
        PayerStats storage p = payers[payer];
        p.defaults += 1;
        p.lastUpdate = uint64(block.timestamp);
        emit PayerDefaultRecorded(payer, issuer, amount);
        emit ScoreUpdated(payer, clientScore(payer));
    }

    function recordIssuerFault(address issuer, uint256 amount) external onlyWriter {
        IssuerStats storage i = issuers[issuer];
        i.faults += 1;
        i.lastUpdate = uint64(block.timestamp);
        emit IssuerFaultRecorded(issuer, amount);
    }

    function issuerFaults(address issuer) external view returns (uint256) {
        return issuers[issuer].faults;
    }

    function hasHistory(address payer) external view returns (bool) {
        PayerStats storage p = payers[payer];
        return p.settled > 0 || p.defaults > 0;
    }

    function clientScore(address payer) public view returns (uint256) {
        PayerStats storage p = payers[payer];
        if (p.settled == 0) return 0;

        uint256 onTimeRate = (uint256(p.onTime) * MAX_SCORE) / p.settled;

        uint256 wholeMUSD = uint256(p.volume) / 1e18;
        uint256 volumeFactor = wholeMUSD == 0 ? 0 : Math.min(MAX_SCORE, (Math.log10(wholeMUSD) * MAX_SCORE) / 5);

        uint256 diversityFactor = Math.min(MAX_SCORE, uint256(p.distinctIssuers) * 250);

        uint256 raw = (onTimeRate * volumeFactor * diversityFactor) / (MAX_SCORE * MAX_SCORE);
        uint256 penalty = uint256(p.defaults) * 250;
        return raw > penalty ? raw - penalty : 0;
    }
}
