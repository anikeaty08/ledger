// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../BaseTest.sol";
import {CollectionsManager} from "../../src/credit/CollectionsManager.sol";
import {CreditPolicy} from "../../src/credit/CreditPolicy.sol";
import {InvoiceStatus} from "../../src/libraries/Types.sol";

contract CollectionsTest is BaseTest {
    function setUp() public override {
        super.setUp();
        // Lower new-client recourse to 20% so defaults produce real tranche losses.
        CreditPolicy.Tier[] memory scored = new CreditPolicy.Tier[](3);
        scored[0] = CreditPolicy.Tier(1, 6_000, 160, 5_000);
        scored[1] = CreditPolicy.Tier(500, 7_000, 120, 2_000);
        scored[2] = CreditPolicy.Tier(800, 8_000, 90, 0);
        vm.prank(owner);
        L.policy.setTiers(CreditPolicy.Tier(0, 5_000, 200, 2_000), CreditPolicy.Tier(0, 8_000, 80, 0), scored);
    }

    function _financed() internal returns (uint256 id) {
        id = _createAccepted(2_000e18, 30 days);
        _advance(id, 1_000e18, 200e18, 0); // senior 800, junior 200, recourse 200
    }

    function test_declareDefault_onlyAfterGrace() public {
        uint256 id = _financed();
        vm.warp(block.timestamp + 30 days + 15 days);
        vm.expectRevert(CollectionsManager.GraceNotOver.selector);
        L.collections.declareDefault(id);
        vm.warp(block.timestamp + 1);
        L.collections.declareDefault(id);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Defaulted));
    }

    function test_default_juniorTakesFirstLoss() public {
        uint256 id = _financed();
        uint256 seniorAssets = L.senior.totalAssets();
        uint256 juniorAssets = L.junior.totalAssets();

        vm.warp(block.timestamp + 46 days);
        L.collections.declareDefault(id);

        // recourse 200 goes to senior principal first: senior loses 600, junior loses its whole 200
        assertEq(_adv(id).seniorLoss, 600e18);
        assertEq(_adv(id).juniorLoss, 200e18);
        assertEq(L.senior.totalAssets(), seniorAssets - 600e18);
        assertEq(L.junior.totalAssets(), juniorAssets - 200e18);
        assertEq(L.engine.totalOutstanding(), 0);
        assertEq(L.engine.payerExposure(client), 0);

        (,,, uint32 defaults,,,) = L.reputation.payers(client);
        assertEq(defaults, 1);
        assertEq(L.reputation.clientScore(client), 0);
    }

    function test_lateRecovery_afterDefault() public {
        uint256 id = _financed();
        vm.warp(block.timestamp + 46 days);
        L.collections.declareDefault(id);
        uint256 freelancerBefore = musd.balanceOf(freelancer);

        uint256 owed = L.registry.amountOwed(id);
        assertEq(owed, 2_040e18); // 2,000 + 2% late fee (16 days late = 2 started periods)
        vm.prank(client);
        L.router.pay(id, owed);
        assertEq(L.engine.recoveryDue(id), 0);
        assertEq(L.senior.totalLosses(), 600e18);
        // senior recovers 600, junior 200, freelancer gets the rest
        assertEq(musd.balanceOf(freelancer) - freelancerBefore, owed - 800e18);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Defaulted), "record stays defaulted");
    }

    function test_default_btcRecourseIsSwapped() public {
        uint256 id = _createAccepted(2_000e18, 30 days);
        // 20% of 1,000 = 200 required; 0.005 BTC × 60k × 80% = 240
        _advance(id, 1_000e18, 0, 0.005 ether);
        vm.warp(block.timestamp + 46 days);
        L.collections.declareDefault(id);
        // 0.005 BTC → 300 × 0.997 = 299.1 MUSD recovered
        assertEq(_adv(id).seniorLoss, 800e18 - 299.1e18);
        assertEq(_adv(id).juniorLoss, 200e18);
    }

    function test_default_overCollateralizedRecourseReturnsSurplus() public {
        uint256 id = _createAccepted(2_000e18, 30 days);
        _advance(id, 1_000e18, 1_500e18, 0);
        uint256 before = musd.balanceOf(freelancer);
        vm.warp(block.timestamp + 46 days);
        L.collections.declareDefault(id);
        // 1,500 recourse covers 1,000 principal + 17 LP fee (protocol's 3 fee is waived on default);
        // surplus 483 returns to the freelancer.
        assertEq(musd.balanceOf(freelancer) - before, 483e18);
        assertEq(_adv(id).seniorLoss + _adv(id).juniorLoss, 0);
    }

    function test_dispute_payerAtFault_restores() public {
        uint256 id = _financed();
        vm.prank(client);
        L.registry.openDispute(id, bytes32("not delivered"));
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Disputed));

        vm.prank(makeAddr("rando"));
        vm.expectRevert(CollectionsManager.NotResolver.selector);
        L.collections.resolveDispute(id, true);

        vm.prank(resolver);
        L.collections.resolveDispute(id, true);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Financed));
    }

    function test_dispute_issuerAtFault_voidsAndSeizes() public {
        uint256 id = _financed();
        vm.prank(client);
        L.registry.openDispute(id, bytes32("not delivered"));
        vm.prank(resolver);
        L.collections.resolveDispute(id, false);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Defaulted));
        assertEq(L.reputation.issuerFaults(freelancer), 1);
        (,,, uint32 defaults,,,) = L.reputation.payers(client);
        assertEq(defaults, 0, "client not penalized");
    }

    function test_issuerWithTwoFaults_isIneligible() public {
        for (uint256 i; i < 2; ++i) {
            uint256 id = _financed();
            vm.prank(resolver);
            L.collections.reportDiversion(id);
        }
        uint256 next = _createAccepted(2_000e18, 30 days);
        assertFalse(L.engine.quote(next).eligible);
    }

    function test_paymentDuringDispute_settles() public {
        uint256 id = _financed();
        vm.prank(freelancer);
        L.registry.openDispute(id, bytes32("late"));
        vm.prank(client);
        L.router.pay(id, 2_000e18);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled));
        assertFalse(L.engine.hasActiveAdvance(id));
    }

    function test_circuitBreaker_pausesNewAdvances() public {
        vm.prank(owner);
        L.engine.setParams(2_000, 3_000, 1_500, 8_000, 1_000, 50); // trip above 0.5% of TVL
        uint256 id = _financed();
        vm.warp(block.timestamp + 46 days);
        L.collections.declareDefault(id);
        assertTrue(L.engine.paused());
    }
}
