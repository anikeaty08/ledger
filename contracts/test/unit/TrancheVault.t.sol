// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../BaseTest.sol";
import {TrancheVault} from "../../src/vaults/TrancheVault.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

contract TrancheVaultTest is BaseTest {
    function test_onlyEngineHooks() public {
        vm.expectRevert(TrancheVault.OnlyEngine.selector);
        L.senior.fund(1);
        vm.expectRevert(TrancheVault.OnlyEngine.selector);
        L.senior.onLoss(1);
    }

    function test_juniorCooldown() public {
        vm.startPrank(lpJunior);
        assertEq(L.junior.maxWithdraw(lpJunior), 0);
        L.junior.requestWithdraw();
        vm.warp(block.timestamp + 7 days);
        assertEq(L.junior.maxWithdraw(lpJunior), 20_000e18);
        L.junior.withdraw(1_000e18, lpJunior, lpJunior);
        assertEq(musd.balanceOf(lpJunior), 1_000e18);
        assertEq(L.junior.maxWithdraw(lpJunior), 0, "request consumed");
        vm.stopPrank();
    }

    function test_juniorCooldown_windowExpires() public {
        vm.prank(lpJunior);
        L.junior.requestWithdraw();
        vm.warp(block.timestamp + 7 days + 3 days + 1);
        assertEq(L.junior.maxWithdraw(lpJunior), 0);
    }

    function test_withdrawLimitedByLiquidity() public {
        uint256 id = _createAccepted(18_000e18, 60 days);
        _advance(id, 9_000e18, 9_000e18, 0); // senior deploys 7,200
        assertEq(L.senior.maxWithdraw(lpSenior), 80_000e18 - 7_200e18);
        assertEq(L.senior.utilizationBps(), 900);
    }

    function test_sink_parksIdleAndFundsFromIt() public {
        vm.startPrank(owner);
        L.senior.setSink(IERC4626(address(savings)));
        L.senior.park(79_000e18);
        vm.stopPrank();
        assertEq(L.senior.totalAssets(), 80_000e18);

        savings.accrue(790e18); // floor yield
        assertApproxEqAbs(L.senior.totalAssets(), 80_790e18, 1e9);

        // an advance larger than idle pulls liquidity back from the sink
        uint256 id = _createAccepted(18_000e18, 60 days);
        _advance(id, 9_000e18, 9_000e18, 0);
        assertEq(L.senior.deployed(), 7_200e18);
    }

    function test_setSink_rejectsWrongAsset() public {
        TrancheVault other = new TrancheVault(btc, "x", "x", owner, 0);
        vm.prank(owner);
        vm.expectRevert(TrancheVault.BadParams.selector);
        L.senior.setSink(IERC4626(address(other)));
    }

    function test_inflationAttackMitigated() public {
        TrancheVault v = new TrancheVault(musd, "t", "t", owner, 0);
        address attacker = makeAddr("attacker");
        address victim = makeAddr("victim");
        musd.mint(attacker, 10_001e18);
        musd.mint(victim, 10_000e18);

        vm.startPrank(attacker);
        musd.approve(address(v), 1);
        v.deposit(1, attacker);
        musd.transfer(address(v), 10_000e18); // donation
        vm.stopPrank();

        vm.startPrank(victim);
        musd.approve(address(v), 10_000e18);
        uint256 shares = v.deposit(10_000e18, victim);
        vm.stopPrank();
        assertGt(shares, 0);
        assertApproxEqRel(v.previewRedeem(shares), 10_000e18, 0.01e18);
    }
}
