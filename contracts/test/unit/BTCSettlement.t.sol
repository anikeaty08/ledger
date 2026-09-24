// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../BaseTest.sol";
import {BTCSwapper} from "../../src/settlement/BTCSwapper.sol";
import {SettlementRouter} from "../../src/settlement/SettlementRouter.sol";
import {Splitter} from "../../src/settlement/Splitter.sol";
import {LedgerAccount} from "../../src/accounts/LedgerAccount.sol";
import {InvoiceStatus} from "../../src/libraries/Types.sol";

contract BTCSettlementTest is BaseTest {
    function test_payWithBTC_swapsAtOracle() public {
        uint256 id = _createAccepted(3_000e18, 30 days);
        vm.prank(client);
        L.router.payWithBTC{value: 0.05 ether}(id, 0); // 0.05 × 60k = 3,000 → 2,991 after 0.3% pool fee
        assertEq(musd.balanceOf(freelancer), 2_991e18);
        assertEq(L.registry.getInvoice(id).paid, 2_991e18);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.PartiallyPaid));
    }

    function test_payWithBTC_rejectsManipulatedPool() public {
        uint256 id = _createAccepted(3_000e18, 30 days);
        mezoRouter.setSkew(400); // pool quotes 4.3% below oracle (> 3% max deviation)
        vm.prank(client);
        vm.expectRevert();
        L.router.payWithBTC{value: 0.05 ether}(id, 0);
    }

    function test_payWithBTC_respectsCallerMinOut() public {
        uint256 id = _createAccepted(3_000e18, 30 days);
        vm.prank(client);
        vm.expectRevert(bytes("INSUFFICIENT_OUTPUT"));
        L.router.payWithBTC{value: 0.05 ether}(id, 2_995e18);
    }

    function test_payWithBTC_repaysAdvanceFirst() public {
        uint256 id = _createAccepted(3_000e18, 60 days);
        _advance(id, 1_500e18, 1_500e18, 0);
        vm.prank(client);
        L.router.payWithBTC{value: 0.051 ether}(id, 0); // 3,060 × 0.997 = 3,050.82
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled));
        assertEq(L.engine.vaultDue(id), 0);
        assertEq(L.senior.deployed(), 0);
    }

    function _setupKeepBTC() internal returns (address account) {
        vm.startPrank(freelancer);
        account = L.accounts.createAccount();
        L.router.setPayoutPrefs(address(0), false, true, 25_000); // keep BTC at 250% CR
        vm.stopPrank();
    }

    function test_keepBTC_opensTroveAndSettles() public {
        address account = _setupKeepBTC();
        uint256 id = _createAccepted(10_000e18, 30 days);
        // small buffer over the exact BTC/price round trip so the credited value clears amountOwed
        uint256 btcAmount = 10_000e18 * 1e18 / BTC_PRICE + 1e12;
        vm.prank(client);
        L.router.payWithBTC{value: btcAmount}(id, 0);

        (uint256 coll, uint256 debt,, bool active) = LedgerAccount(payable(account)).position();
        assertTrue(active);
        assertEq(coll, btcAmount);
        // mint + 0.1% fee + gas comp; the 1e12-wei buffer above scales ~24,000x through /2.5 and the
        // 0.1% fee, so the tolerance here is wider than the raw buffer size.
        assertApproxEqAbs(debt, 4_000e18 + 4e18 + 200e18, 1e17);
        assertApproxEqAbs(musd.balanceOf(freelancer), 4_000e18, 1e17, "MUSD minted against the kept BTC");
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled), "credited at full BTC value");
    }

    function test_keepBTC_mintsEnoughToRepayVault() public {
        _setupKeepBTC();
        uint256 id = _createAccepted(10_000e18, 60 days);
        _advance(id, 5_000e18, 5_000e18, 0);
        uint256 before = musd.balanceOf(freelancer);
        vm.prank(client);
        // small buffer over the exact BTC/price round trip so the credited value clears amountOwed
        L.router.payWithBTC{value: 10_000e18 * 1e18 / BTC_PRICE + 1e12}(id, 0);

        // debt = max(10,000 / 2.5, vault due 5,200) = 5,200 → vault fully repaid, nothing left over
        assertEq(L.engine.vaultDue(id), 0);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Settled));
        assertEq(musd.balanceOf(freelancer) - before, 5_000e18, "recourse returned; remainder 0");
    }

    function test_keepBTC_fallsBackToSwapBelowMinDebt() public {
        address account = _setupKeepBTC();
        uint256 id = _createAccepted(1_000e18, 30 days);
        vm.prank(client);
        L.router.payWithBTC{value: 1_000e18 * 1e18 / BTC_PRICE}(id, 0); // 400 MUSD < 1,800 min net debt

        (,,, bool active) = LedgerAccount(payable(account)).position();
        assertFalse(active);
        assertApproxEqAbs(musd.balanceOf(freelancer), 997e18, 1e12, "swapped instead");
    }

    function test_setPayoutPrefs_validation() public {
        vm.startPrank(freelancer);
        vm.expectRevert(SettlementRouter.BadPrefs.selector);
        L.router.setPayoutPrefs(address(0), false, true, 25_000); // no account yet
        L.accounts.createAccount();
        vm.expectRevert(SettlementRouter.BadPrefs.selector);
        L.router.setPayoutPrefs(address(0), false, true, 15_000); // CR below 200%
        vm.stopPrank();
    }

    function test_splitterPayout() public {
        address a = makeAddr("dev");
        address b = makeAddr("designer");
        address[] memory rs = new address[](3);
        rs[0] = freelancer;
        rs[1] = a;
        rs[2] = b;
        uint16[] memory bps = new uint16[](3);
        bps[0] = 5_000;
        bps[1] = 3_000;
        bps[2] = 2_000;
        address splitter = L.splitters.getOrCreate(rs, bps);
        assertEq(L.splitters.getOrCreate(rs, bps), splitter, "deterministic + reusable");
        assertEq(L.splitters.predict(rs, bps), splitter);

        vm.prank(freelancer);
        L.router.setPayoutPrefs(splitter, false, false, 0);

        uint256 id = _createAccepted(1_000e18, 30 days);
        vm.prank(client);
        L.router.pay(id, 1_000e18);
        assertEq(musd.balanceOf(freelancer), 500e18);
        assertEq(musd.balanceOf(a), 300e18);
        assertEq(musd.balanceOf(b), 200e18);
    }

    function test_splitter_badConfigReverts() public {
        address[] memory rs = new address[](2);
        rs[0] = freelancer;
        rs[1] = client;
        uint16[] memory bps = new uint16[](2);
        bps[0] = 5_000;
        bps[1] = 4_000;
        vm.expectRevert(Splitter.BadConfig.selector);
        L.splitters.getOrCreate(rs, bps);
    }

    function test_swapper_routeValidation() public {
        vm.prank(owner);
        vm.expectRevert(BTCSwapper.BadParams.selector);
        L.swapper.setParams(600, 100);
    }
}
