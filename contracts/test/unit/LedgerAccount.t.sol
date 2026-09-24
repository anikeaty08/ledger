// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../BaseTest.sol";
import {LedgerAccount} from "../../src/accounts/LedgerAccount.sol";
import {LedgerAccountFactory} from "../../src/accounts/LedgerAccountFactory.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

contract LedgerAccountTest is BaseTest {
    LedgerAccount internal acct;

    function setUp() public override {
        super.setUp();
        vm.startPrank(freelancer);
        acct = LedgerAccount(payable(L.accounts.createAccount()));
        L.router.setPayoutPrefs(address(0), true, true, 25_000); // income → account, keep BTC
        acct.configureTreasury(IERC4626(address(savings)), true, 5_000); // 50% of income reserved for paydown
        vm.stopPrank();

        // Open a position: 10k invoice paid in BTC → 4,000 MUSD debt (+ fee + gas comp)
        uint256 id = _createAccepted(10_000e18, 30 days);
        vm.prank(client);
        L.router.payWithBTC{value: 10_000e18 * 1e18 / BTC_PRICE}(id, 0);
    }

    function test_factory_oneAccountPerUser() public {
        assertEq(L.accounts.accountOf(freelancer), address(acct));
        assertEq(L.accounts.predict(freelancer), address(acct));
        vm.prank(freelancer);
        vm.expectRevert(LedgerAccountFactory.AlreadyExists.selector);
        L.accounts.createAccount();
    }

    function test_keepBTCIncome_flowsIntoTreasury() public {
        // the ~4,000 MUSD minted in setUp was income to the account: 50% reserved, 50% swept to savings
        // (a few wei short of an exact 4,000 due to the BTC-amount/oracle round trip in the test setup)
        assertApproxEqAbs(acct.reservedForPaydown(), 2_000e18, 1e12);
        assertApproxEqAbs(acct.yieldBalance(), 2_000e18, 1e12);
        assertApproxEqAbs(acct.yieldPrincipal(), 2_000e18, 1e12);
    }

    function test_onlyRouterHooks() public {
        vm.expectRevert(LedgerAccount.NotRouter.selector);
        acct.onIncome(1);
        vm.expectRevert(LedgerAccount.NotRouter.selector);
        acct.borrowAgainstBTC(1, address(0), address(0));
    }

    function test_paydown_usesReservedAndYield() public {
        savings.accrue(100e18); // savings yield
        (, uint256 debtBefore,,) = acct.position();
        vm.prank(keeper);
        uint256 paid = acct.paydown(address(0), address(0));
        (, uint256 debtAfter,,) = acct.position();
        // headroom = 4,204 − (1,800 min + 200 gas comp handled by mock) → capped by mock's floor
        assertEq(debtBefore - debtAfter, paid);
        assertGt(paid, 0);
        assertLe(debtAfter, debtBefore);
    }

    function test_guardian_repaysWhenICRDrops() public {
        vm.startPrank(freelancer);
        acct.configureGuardian(LedgerAccount.GuardianConfig(true, 18_000, 15_000, 20_000, 12_500, 5_000e18, 1 ether));
        vm.stopPrank();

        // ICR ≈ 2.38 at 60k; drop BTC to 36k → ICR ≈ 1.43 (< 150% action threshold)
        feed.set(36_000e18);
        uint256 icrBefore = acct.currentICR();
        assertLt(icrBefore, 1.5e18);
        vm.prank(keeper);
        acct.guardianCheck(address(0), address(0));
        assertGt(acct.currentICR(), icrBefore, "guardian reduced risk");
    }

    function test_guardian_addsBTCBufferWhenCritical() public {
        vm.startPrank(freelancer);
        acct.configureGuardian(LedgerAccount.GuardianConfig(true, 18_000, 15_000, 20_000, 12_500, 0, 1 ether));
        vm.stopPrank();
        vm.deal(address(acct), 0.5 ether); // BTC buffer

        feed.set(30_000e18); // ICR ≈ 1.19 < 125% critical; repay budget is 0 → must add collateral
        vm.prank(keeper);
        acct.guardianCheck(address(0), address(0));
        assertGe(acct.currentICR(), 1.99e18);
    }

    function test_guardian_disabledOrHealthyReverts() public {
        vm.expectRevert(LedgerAccount.NothingToDo.selector);
        acct.guardianCheck(address(0), address(0));
        vm.prank(freelancer);
        acct.configureGuardian(LedgerAccount.GuardianConfig(true, 18_000, 15_000, 20_000, 12_500, 5_000e18, 1 ether));
        vm.expectRevert(LedgerAccount.NothingToDo.selector);
        acct.guardianCheck(address(0), address(0)); // healthy
    }

    function test_guardian_badConfigReverts() public {
        vm.prank(freelancer);
        vm.expectRevert(LedgerAccount.BadConfig.selector);
        acct.configureGuardian(LedgerAccount.GuardianConfig(true, 18_000, 15_000, 14_000, 12_500, 0, 0));
    }

    function test_ownerControls() public {
        vm.prank(keeper);
        vm.expectRevert(LedgerAccount.NotOwner.selector);
        acct.withdrawMUSD(1, keeper);

        vm.prank(freelancer);
        acct.withdrawMUSD(2_500e18, freelancer); // pulls from savings when idle is short
        assertEq(musd.balanceOf(freelancer), 2_500e18);
    }

    function test_execute_escapeHatch() public {
        vm.prank(freelancer);
        acct.execute(address(musd), 0, abi.encodeWithSignature("transfer(address,uint256)", freelancer, 1e18));
        assertEq(musd.balanceOf(freelancer), 1e18);
    }
}
