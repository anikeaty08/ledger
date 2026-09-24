// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../BaseTest.sol";
import {AdvanceEngine} from "../../src/credit/AdvanceEngine.sol";
import {CreditPolicy} from "../../src/credit/CreditPolicy.sol";
import {InvoiceStatus} from "../../src/libraries/Types.sol";

contract AdvanceFlowTest is BaseTest {
    function test_quote_newClientTier() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        AdvanceEngine.Quote memory q = L.engine.quote(id);
        assertTrue(q.eligible);
        assertEq(q.advanceRateBps, 5_000);
        assertEq(q.feePer30dBps, 200);
        assertEq(q.recourseBps, 10_000);
        assertEq(q.maxAdvance, 1_000e18);
        assertEq(q.feeForMax, 40e18); // 2% × 2 periods
        assertEq(q.tenorDays, 60);
    }

    function test_advance_requiresRecourse() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        musd.mint(freelancer, 500e18);
        vm.startPrank(freelancer);
        musd.approve(address(L.engine), 500e18);
        L.receivable.approve(address(L.engine), id);
        vm.expectRevert(abi.encodeWithSelector(AdvanceEngine.InsufficientRecourse.selector, 1_000e18, 500e18));
        L.engine.requestAdvance(id, 1_000e18, type(uint256).max, 500e18);
        vm.stopPrank();
    }

    function test_advance_btcRecourseCountsAtHaircut() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        // 1,000 MUSD recourse needed; 0.025 BTC × 60k × 80% = 1,200 → enough
        _advance(id, 1_000e18, 0, 0.025 ether);
        assertEq(_adv(id).recourseBTC, 0.025 ether);
    }

    function test_advance_fundsFromTranchesAndLocksNFT() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        uint256 before = musd.balanceOf(freelancer);
        _advance(id, 1_000e18, 1_000e18, 0);

        assertEq(musd.balanceOf(freelancer) - before, 1_000e18, "advance paid (recourse minted+pulled)");
        assertEq(L.receivable.ownerOf(id), address(L.engine));
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Financed));
        assertEq(L.senior.deployed(), 800e18);
        assertEq(L.junior.deployed(), 200e18);
        assertEq(L.engine.payerExposure(client), 1_000e18);
        assertEq(L.engine.vaultDue(id), 1_040e18);
    }

    function test_advance_rejectsNonIssuerAndLimits() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        vm.prank(client);
        vm.expectRevert(AdvanceEngine.NotIssuer.selector);
        L.engine.requestAdvance(id, 1_000e18, type(uint256).max, 0);

        vm.startPrank(freelancer);
        L.receivable.approve(address(L.engine), id);
        vm.expectRevert(abi.encodeWithSelector(AdvanceEngine.TooLarge.selector, 1_000e18));
        L.engine.requestAdvance(id, 1_001e18, type(uint256).max, 2_000e18);
        vm.expectRevert(AdvanceEngine.TooSmall.selector);
        L.engine.requestAdvance(id, 1e18, type(uint256).max, 0);
        vm.expectRevert(abi.encodeWithSelector(AdvanceEngine.FeeTooHigh.selector, 40e18));
        L.engine.requestAdvance(id, 1_000e18, 39e18, 1_000e18);
        vm.stopPrank();
    }

    function test_advance_tenorBounds() public {
        uint256 shortId = _createAccepted(2_000e18, 3 days);
        assertFalse(L.engine.quote(shortId).eligible);
        uint256 longId = _createAccepted(2_000e18, 150 days);
        assertFalse(L.engine.quote(longId).eligible);
    }

    function test_fullPayment_runsWaterfall() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        _advance(id, 1_000e18, 1_000e18, 0);
        uint256 freelancerBefore = musd.balanceOf(freelancer);

        vm.warp(block.timestamp + 50 days);
        vm.prank(client);
        L.router.pay(id, 2_000e18);

        // fee 40: protocol 15% = 6; LP 34 → junior 30% = 10.2, senior 23.8
        assertEq(L.engine.protocolFeesAccrued(), 6e18);
        assertEq(L.senior.totalFeesEarned(), 23.8e18);
        assertEq(L.junior.totalFeesEarned(), 10.2e18);
        assertEq(L.senior.deployed(), 0);
        assertEq(L.junior.deployed(), 0);

        // freelancer gets remainder 960 + recourse 1,000 back; NFT returned
        assertEq(musd.balanceOf(freelancer) - freelancerBefore, 960e18 + 1_000e18);
        assertEq(L.receivable.ownerOf(id), freelancer);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled));
        assertFalse(L.engine.hasActiveAdvance(id));
        assertEq(L.engine.payerExposure(client), 0);
        assertEq(L.engine.openAdvances(freelancer), 0);

        (uint32 settled, uint32 onTime,,,,,) = L.reputation.payers(client);
        assertEq(settled, 1);
        assertEq(onTime, 1);
    }

    function test_feesUnlockLinearly() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        _advance(id, 1_000e18, 1_000e18, 0);
        uint256 seniorBefore = L.senior.totalAssets();
        vm.prank(client);
        L.router.pay(id, 2_000e18);
        assertEq(L.senior.totalAssets(), seniorBefore, "no instant jump");
        vm.warp(block.timestamp + 3.5 days);
        assertApproxEqAbs(L.senior.totalAssets(), seniorBefore + 11.9e18, 1e6);
        vm.warp(block.timestamp + 4 days);
        assertEq(L.senior.totalAssets(), seniorBefore + 23.8e18);
    }

    function test_partialPayments() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        _advance(id, 1_000e18, 1_000e18, 0);

        vm.prank(client);
        L.router.pay(id, 700e18); // senior principal first
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.PartiallyPaid));
        assertEq(_adv(id).seniorPrincipalDue, 100e18);

        vm.prank(client);
        L.router.pay(id, 500e18); // clears remaining principal + fees; 160 remainder
        assertEq(L.engine.vaultDue(id), 0);

        vm.prank(client);
        uint256 used = L.router.pay(id, 5_000e18); // over-payment capped
        assertEq(used, 800e18);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled));
    }

    function test_payWithoutAdvance_goesToHolder() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        address buyer = makeAddr("receivableBuyer");
        vm.prank(freelancer);
        L.receivable.transferFrom(freelancer, buyer, id);

        vm.prank(client);
        L.router.pay(id, 2_000e18);
        assertEq(musd.balanceOf(buyer), 2_000e18, "proceeds follow the receivable NFT");
    }

    function test_latePayment_includesLateFee() public {
        uint256 id = _createAccepted(2_000e18, 30 days);
        vm.warp(block.timestamp + 31 days);
        assertEq(L.registry.amountOwed(id), 2_020e18);
        vm.prank(client);
        L.router.pay(id, 2_020e18);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled));
        (,, uint32 late,,,,) = L.reputation.payers(client);
        assertEq(late, 0, "1 day late is within the on-time grace");
    }

    function test_goldTier_noRecourseNeeded() public {
        _makeGold(client, clientPk);
        assertEq(L.reputation.clientScore(client), 1000);
        uint256 id = _createAccepted(10_000e18, 30 days);
        AdvanceEngine.Quote memory q = L.engine.quote(id);
        assertEq(q.advanceRateBps, 8_000);
        assertEq(q.recourseBps, 0);
        _advance(id, 8_000e18, 0, 0);
        assertEq(_adv(id).fee, 72e18); // 0.9% × 1 period
    }

    function test_verifiedPayerTier() public {
        vm.prank(owner);
        L.policy.setAttester(owner, true);
        vm.prank(owner);
        L.policy.setVerifiedPayer(client, true);
        uint256 id = _createAccepted(5_000e18, 30 days);
        assertEq(L.engine.quote(id).recourseBps, 0);
        assertEq(L.engine.quote(id).feePer30dBps, 80);
    }

    function test_exposureCap_perClient() public {
        vm.prank(owner);
        L.policy.setAttester(owner, true);
        vm.prank(owner);
        L.policy.setVerifiedPayer(client, true);
        // cap = min(25k, 10% of 100k TVL) = 10k
        uint256 a = _createAccepted(10_000e18, 30 days);
        _advance(a, 8_000e18, 0, 0);
        uint256 b = _createAccepted(10_000e18, 30 days);
        assertEq(L.engine.quote(b).maxAdvance, 2_000e18);
    }

    function test_maxOpenAdvances() public {
        for (uint256 i; i < 5; ++i) {
            uint256 id = _createAccepted(400e18, 30 days);
            _advance(id, 200e18, 200e18, 0);
        }
        uint256 extra = _createAccepted(400e18, 30 days);
        musd.mint(freelancer, 200e18);
        vm.startPrank(freelancer);
        musd.approve(address(L.engine), 200e18);
        L.receivable.approve(address(L.engine), extra);
        vm.expectRevert(AdvanceEngine.TooManyOpen.selector);
        L.engine.requestAdvance(extra, 200e18, type(uint256).max, 200e18);
        vm.stopPrank();
    }

    function test_pausedBlocksAdvancesButNotPayments() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        _advance(id, 1_000e18, 1_000e18, 0);
        vm.prank(owner);
        L.engine.pause();

        uint256 id2 = _createAccepted(2_000e18, 60 days);
        vm.startPrank(freelancer);
        L.receivable.approve(address(L.engine), id2);
        vm.expectRevert();
        L.engine.requestAdvance(id2, 1_000e18, type(uint256).max, 0);
        vm.stopPrank();

        vm.prank(client);
        L.router.pay(id, 2_000e18); // settlement still works while paused
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled));
    }

    function test_protocolFeesWithdraw() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        _advance(id, 1_000e18, 1_000e18, 0);
        vm.prank(client);
        L.router.pay(id, 2_000e18);
        vm.prank(owner);
        L.engine.withdrawProtocolFees(treasury);
        assertEq(musd.balanceOf(treasury), 6e18);
    }

    function test_previewPayment() public {
        uint256 id = _createAccepted(2_000e18, 60 days);
        _advance(id, 1_000e18, 1_000e18, 0);
        (uint256 used, uint256 toVaults, uint256 remainder) = L.router.previewPayment(id, 3_000e18);
        assertEq(used, 2_000e18);
        assertEq(toVaults, 1_040e18);
        assertEq(remainder, 960e18);
    }

    function testFuzz_advanceAndSettle(uint128 face, uint64 tenorDays, uint16 advPct) public {
        face = uint128(bound(face, 100e18, 18_000e18));
        tenorDays = uint64(bound(tenorDays, 7, 120));
        advPct = uint16(bound(advPct, 1, 100));
        uint256 id = _createAccepted(face, tenorDays * 1 days);
        AdvanceEngine.Quote memory q = L.engine.quote(id);
        vm.assume(q.eligible && q.maxAdvance >= 10e18);
        uint256 amount = (q.maxAdvance * advPct) / 100;
        vm.assume(amount >= 10e18);
        _advance(id, amount, amount, 0);

        uint256 fee = _adv(id).fee;
        assertLe(amount + fee, face, "advance + fee fits the face value");

        vm.prank(client);
        L.router.pay(id, face);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled));
        assertEq(L.senior.deployed() + L.junior.deployed(), 0);
        assertEq(L.engine.totalOutstanding(), 0);
    }
}
