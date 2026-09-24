// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LedgerDeployer} from "../../script/LedgerDeployer.sol";
import {MockMUSD} from "../mocks/Mocks.sol";
import {InvoiceStatus} from "../../src/libraries/Types.sol";
import {AdvanceEngine} from "../../src/credit/AdvanceEngine.sol";
import {CreditPolicy} from "../../src/credit/CreditPolicy.sol";

/// @notice Drives bounded-random sequences of the real user flows (create → accept → advance → pay
///         [→ default]) against a real deployed Suite, and tracks ghost state the invariant test
///         checks against the contracts' own view functions after every call.
contract Handler is Test {
    LedgerDeployer.Suite internal L;
    MockMUSD internal musd;

    address internal freelancer = makeAddr("h_freelancer");
    address internal client;
    uint256 internal clientPk = 0xC11E47;

    uint256[] public createdIds;
    uint256[] public advancedIds; // subset of createdIds that received an advance and is still active
    mapping(uint256 => bool) public wasEverAdvanced;

    // Ghost accounting: what the handler itself believes should be true, checked against the real
    // contracts' state in the invariant test — catches drift a hand-proof could miss.
    uint256 public ghost_sumAdvancePrincipal;
    uint256 public ghost_sumRepaidPrincipal;
    uint256 public ghost_sumDefaultedPrincipal;

    uint256 public calls_create;
    uint256 public calls_advance;
    uint256 public calls_pay;
    uint256 public calls_default;

    constructor(LedgerDeployer.Suite memory suite, MockMUSD musd_) {
        L = suite;
        musd = musd_;
        client = vm.addr(clientPk);
        vm.deal(freelancer, 1000 ether);
        vm.deal(client, 1000 ether);
    }

    function createAndAccept(uint128 amountSeed, uint64 tenorDaysSeed) external {
        calls_create++;
        uint128 amount = uint128(bound(amountSeed, 100e18, 15_000e18));
        uint64 tenor = uint64(bound(tenorDaysSeed, 8, 119)) * 1 days;

        vm.prank(freelancer);
        uint256 id = L.registry.createInvoice(client, keccak256(abi.encode("h", amount, tenor, block.timestamp)), amount, uint64(block.timestamp) + tenor);

        uint256 deadline = block.timestamp + 1 days;
        bytes32 digest = L.registry.acceptanceDigest(id, client, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(clientPk, digest);
        L.registry.acceptInvoiceWithSig(id, client, deadline, abi.encodePacked(r, s, v));

        createdIds.push(id);
    }

    function advance(uint256 idSeed, uint16 pctOfMax) external {
        if (createdIds.length == 0) return;
        uint256 id = createdIds[idSeed % createdIds.length];
        if (L.registry.getInvoice(id).status != InvoiceStatus.Accepted) return;

        AdvanceEngine.Quote memory q = L.engine.quote(id);
        if (!q.eligible || q.maxAdvance < 10e18) return;
        calls_advance++;

        uint256 pct = bound(pctOfMax, 1, 100);
        uint256 amount = (q.maxAdvance * pct) / 100;
        if (amount < 10e18) amount = 10e18;
        if (amount > q.maxAdvance) amount = q.maxAdvance;

        uint256 fee = L.engine.feeFor(amount, q.feePer30dBps, (L.registry.getInvoice(id).dueDate - block.timestamp));
        uint256 recourse = L.engine.recourseRequired(amount, q.recourseBps);

        musd.mint(freelancer, recourse);
        vm.startPrank(freelancer);
        musd.approve(address(L.engine), recourse);
        L.receivable.approve(address(L.engine), id);
        try L.engine.requestAdvance(id, amount, fee + fee / 10 + 1, recourse) {
            advancedIds.push(id);
            wasEverAdvanced[id] = true;
            ghost_sumAdvancePrincipal += amount;
        } catch {}
        vm.stopPrank();
    }

    function payInvoice(uint256 idSeed, uint256 amountSeed) external {
        if (createdIds.length == 0) return;
        uint256 id = createdIds[idSeed % createdIds.length];
        InvoiceStatus s = L.registry.getInvoice(id).status;
        if (
            s != InvoiceStatus.Accepted && s != InvoiceStatus.Financed && s != InvoiceStatus.PartiallyPaid
                && s != InvoiceStatus.Overdue
        ) return;

        uint256 owed = L.registry.amountOwed(id);
        if (owed == 0) return;
        calls_pay++;

        uint256 pay = bound(amountSeed, 1e18, owed + 500e18); // sometimes overpay; router caps it
        musd.mint(client, pay);
        vm.startPrank(client);
        musd.approve(address(L.router), pay);
        uint256 due = L.engine.hasActiveAdvance(id) ? L.engine.vaultDue(id) : 0;
        try L.router.pay(id, pay) {
            uint256 applied = due > pay ? pay : due;
            // Only count principal, not fees, toward the principal ghost — matches vaultDue's
            // ordering (principal drains before fees), close enough for a lower-bound sanity check.
            ghost_sumRepaidPrincipal += applied;
        } catch {}
        vm.stopPrank();
    }

    function warpAndDefault(uint256 idSeed, uint32 daysForward) external {
        if (createdIds.length == 0) return;
        uint256 id = createdIds[idSeed % createdIds.length];
        vm.warp(block.timestamp + bound(daysForward, 1, 200) * 1 days);

        InvoiceStatus s = L.registry.getInvoice(id).status;
        if (
            s != InvoiceStatus.Accepted && s != InvoiceStatus.Financed && s != InvoiceStatus.PartiallyPaid
                && s != InvoiceStatus.Overdue
        ) return;
        if (block.timestamp <= L.collections.defaultableAt(id)) return;

        calls_default++;
        uint256 principalBefore = L.engine.hasActiveAdvance(id)
            ? uint256(L.engine.getAdvance(id).seniorPrincipalDue) + L.engine.getAdvance(id).juniorPrincipalDue
            : 0;

        try L.collections.declareDefault(id) {
            AdvanceEngine.Advance memory a = L.engine.getAdvance(id);
            uint256 recovered = principalBefore - uint256(a.seniorLoss) - uint256(a.juniorLoss);
            ghost_sumRepaidPrincipal += recovered;
            ghost_sumDefaultedPrincipal += uint256(a.seniorLoss) + uint256(a.juniorLoss);
        } catch {}
    }

    function createdIdsLength() external view returns (uint256) {
        return createdIds.length;
    }
}
