// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IReputationRegistry, ICreditPolicy} from "../interfaces/ILedger.sol";

/// @title CreditPolicy
/// @notice Maps a client's on-chain payment score to advance terms (recourse factoring).
///
///   Tier      | score      | advance | fee / 30d | recourse
///   New       | no history |   50%   |   2.0%    |  100%
///   Bronze    | 1–499      |   60%   |   1.6%    |   50%
///   Silver    | 500–799    |   70%   |   1.2%    |   20%
///   Gold      | 800+       |   80%   |   0.9%    |    0%
///   Verified  | attested   |   80%   |   0.8%    |    0%
///
/// A client with history but score 0 (e.g. after defaults) is ineligible.
/// Issuers with 2+ recorded faults are ineligible.
contract CreditPolicy is ICreditPolicy, Ownable2Step {
    struct Tier {
        uint16 minScore;
        uint16 advanceRateBps;
        uint16 feePer30dBps;
        uint16 recourseBps;
    }

    IReputationRegistry public immutable reputation;

    Tier public newClientTier = Tier(0, 5_000, 200, 10_000);
    Tier public verifiedTier = Tier(0, 8_000, 80, 0);
    Tier[] public tiers; // ascending by minScore
    uint32 public maxIssuerFaults = 1;

    mapping(address => bool) public isVerifiedPayer;
    mapping(address => bool) public isAttester;

    event TiersSet();
    event AttesterSet(address indexed attester, bool enabled);
    event PayerVerified(address indexed payer, bool verified);

    error BadTier();
    error NotAttester();

    constructor(address owner_, IReputationRegistry reputation_) Ownable(owner_) {
        reputation = reputation_;
        tiers.push(Tier(1, 6_000, 160, 5_000)); // Bronze
        tiers.push(Tier(500, 7_000, 120, 2_000)); // Silver
        tiers.push(Tier(800, 8_000, 90, 0)); // Gold
    }

    function setTiers(Tier calldata newClient, Tier calldata verified, Tier[] calldata scored) external onlyOwner {
        _check(newClient);
        _check(verified);
        delete tiers;
        uint16 prev;
        for (uint256 i; i < scored.length; ++i) {
            _check(scored[i]);
            if (i > 0 && scored[i].minScore <= prev) revert BadTier();
            prev = scored[i].minScore;
            tiers.push(scored[i]);
        }
        newClientTier = newClient;
        verifiedTier = verified;
        emit TiersSet();
    }

    function setMaxIssuerFaults(uint32 n) external onlyOwner {
        maxIssuerFaults = n;
    }

    function setAttester(address a, bool enabled) external onlyOwner {
        isAttester[a] = enabled;
        emit AttesterSet(a, enabled);
    }

    /// @notice KYB attestation for a paying business (Verified tier).
    function setVerifiedPayer(address payer, bool verified) external {
        if (!isAttester[msg.sender]) revert NotAttester();
        isVerifiedPayer[payer] = verified;
        emit PayerVerified(payer, verified);
    }

    function tiersLength() external view returns (uint256) {
        return tiers.length;
    }

    function terms(address payer, address issuer) external view returns (Terms memory t) {
        if (reputation.issuerFaults(issuer) > maxIssuerFaults) return t; // ineligible

        if (isVerifiedPayer[payer]) return _toTerms(verifiedTier);
        if (!reputation.hasHistory(payer)) return _toTerms(newClientTier);

        uint256 score = reputation.clientScore(payer);
        for (uint256 i = tiers.length; i > 0; --i) {
            Tier memory tier = tiers[i - 1];
            if (score >= tier.minScore && tier.minScore > 0) return _toTerms(tier);
        }
        return t; // score 0 with history → ineligible
    }

    function _toTerms(Tier memory tier) internal pure returns (Terms memory) {
        return Terms(true, tier.advanceRateBps, tier.feePer30dBps, tier.recourseBps);
    }

    function _check(Tier memory tier) internal pure {
        if (tier.advanceRateBps > 9_000 || tier.feePer30dBps > 1_000 || tier.recourseBps > 10_000) revert BadTier();
    }
}
