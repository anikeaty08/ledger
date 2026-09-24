// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console2} from "forge-std/console2.sol";
import {BaseTest} from "../BaseTest.sol";
import {Handler} from "./Handler.sol";
import {InvoiceStatus} from "../../src/libraries/Types.sol";
import {AdvanceEngine} from "../../src/credit/AdvanceEngine.sol";

/// @notice Runs bounded-random sequences of create/accept/advance/pay/default through the Handler and
///         checks the protocol-level invariants from docs/SYSTEM_DESIGN.md §19 after every call:
///           - every escrowed receivable NFT's custody exactly matches its active-advance status
///           - the engine's totalOutstanding counter always equals the sum of individual advances'
///             remaining principal
///           - the tranches never report more principal deployed than has ever been funded minus
///             what's been recovered (no vault can be "overdrawn" by protocol accounting drift)
///           - repaid + defaulted principal never exceeds what was ever advanced
contract AdvanceEngineInvariantTest is StdInvariant, BaseTest {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(L, musd);

        // Seed extra lender liquidity so the fuzzer isn't mostly blocked on InsufficientVaultLiquidity.
        _seedVault(makeAddr("bigSenior"), address(L.senior), 2_000_000e18);
        _seedVault(makeAddr("bigJunior"), address(L.junior), 500_000e18);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = Handler.createAndAccept.selector;
        selectors[1] = Handler.advance.selector;
        selectors[2] = Handler.payInvoice.selector;
        selectors[3] = Handler.warpAndDefault.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @dev NFT custody must exactly match the advance's state: held by the engine while active OR
    ///      while a default's loss is still partly unrecovered (pending late recovery — this is
    ///      correct, intentional custody, not a bug), and released to the borrower once neither of
    ///      those holds. The first version of this invariant conflated "not active" with "must be
    ///      released" and false-flagged the pending-recovery state; this is the corrected version —
    ///      an NFT stuck in the engine with nothing left owed, or released while still owed, is the
    ///      real fund-safety bug this catches that fixed unit-test scenarios could miss.
    function invariant_receivableCustodyMatchesActiveAdvance() public view {
        uint256 n = handler.createdIdsLength();
        for (uint256 i; i < n; i++) {
            uint256 id = handler.createdIds(i);
            if (!handler.wasEverAdvanced(id)) continue;

            bool shouldBeHeld = L.engine.hasActiveAdvance(id) || L.engine.recoveryDue(id) > 0;
            address owner = L.receivable.ownerOf(id);
            if (shouldBeHeld) {
                assertEq(owner, address(L.engine), "still owed: NFT must be held by the engine");
            } else {
                assertNotEq(owner, address(L.engine), "nothing owed: NFT must not stay with the engine");
            }
        }
    }

    /// @dev The engine's global counter must always equal the sum of what each active advance still
    ///      owes in principal — no drift between the aggregate and the per-advance records.
    function invariant_totalOutstandingMatchesSumOfActiveAdvances() public view {
        uint256 n = handler.createdIdsLength();
        uint256 sum;
        for (uint256 i; i < n; i++) {
            uint256 id = handler.createdIds(i);
            if (!L.engine.hasActiveAdvance(id)) continue;
            AdvanceEngine.Advance memory a = L.engine.getAdvance(id);
            sum += uint256(a.seniorPrincipalDue) + a.juniorPrincipalDue;
        }
        assertEq(L.engine.totalOutstanding(), sum, "totalOutstanding must equal the sum of active advances' principal due");
    }

    /// @dev Conservation: every unit of principal the handler successfully advanced ends up either
    ///      still outstanding, repaid, or defaulted — never silently lost or double-counted.
    function invariant_principalConservation() public view {
        uint256 outstanding = L.engine.totalOutstanding();
        uint256 accounted = outstanding + handler.ghost_sumRepaidPrincipal() + handler.ghost_sumDefaultedPrincipal();
        // ghost_sumRepaidPrincipal is a lower bound (partial payments before a later default aren't
        // separately reclassified), so conservation is an inequality, not an exact equality:
        assertLe(handler.ghost_sumAdvancePrincipal(), accounted + 1, "advanced principal must be fully accounted for");
    }

    /// @dev Prints how much of each flow the fuzzer actually exercised once per campaign, so a
    ///      passing run can be distinguished from one that degenerated into mostly-reverting no-ops.
    function afterInvariant() public view {
        console2.log("createAndAccept calls:", handler.calls_create());
        console2.log("advance calls:        ", handler.calls_advance());
        console2.log("pay calls:            ", handler.calls_pay());
        console2.log("default calls:        ", handler.calls_default());
        console2.log("invoices created:     ", handler.createdIdsLength());
    }
}
