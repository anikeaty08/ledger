// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseTest} from "../BaseTest.sol";
import {InvoiceRegistry} from "../../src/invoices/InvoiceRegistry.sol";
import {Invoice, InvoiceStatus} from "../../src/libraries/Types.sol";

contract InvoiceRegistryTest is BaseTest {
    function test_create_setsFields() public {
        uint256 id = _create(2_000e18, 60 days);
        Invoice memory inv = L.registry.getInvoice(id);
        assertEq(inv.issuer, freelancer);
        assertEq(inv.payer, client);
        assertEq(inv.amount, 2_000e18);
        assertEq(uint8(inv.status), uint8(InvoiceStatus.Issued));
        assertEq(inv.dueDate, block.timestamp + 60 days);
    }

    function test_create_rejectsBadParams() public {
        vm.startPrank(freelancer);
        vm.expectRevert(InvoiceRegistry.BadParams.selector);
        L.registry.createInvoice(client, bytes32(0), 1e18, uint64(block.timestamp + 10 days));
        vm.expectRevert(InvoiceRegistry.BadParams.selector);
        L.registry.createInvoice(client, bytes32(uint256(1)), 0, uint64(block.timestamp + 10 days));
        vm.expectRevert(InvoiceRegistry.BadParams.selector);
        L.registry.createInvoice(client, bytes32(uint256(1)), 1e18, uint64(block.timestamp + 181 days));
        vm.expectRevert(InvoiceRegistry.WrongPayer.selector);
        L.registry.createInvoice(freelancer, bytes32(uint256(1)), 1e18, uint64(block.timestamp + 10 days));
        vm.stopPrank();
    }

    function test_acceptWithSig_mintsReceivable() public {
        uint256 id = _create(2_000e18, 60 days);
        _accept(id);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Accepted));
        assertEq(L.receivable.ownerOf(id), freelancer);
        assertTrue(bytes(L.receivable.tokenURI(id)).length > 0);
    }

    function test_acceptWithSig_rejectsWrongSigner() public {
        uint256 id = _create(2_000e18, 60 days);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signAcceptance(id, 0xBAD, deadline);
        vm.expectRevert(InvoiceRegistry.BadSignature.selector);
        L.registry.acceptInvoiceWithSig(id, client, deadline, sig);
    }

    function test_acceptWithSig_rejectsExpired() public {
        uint256 id = _create(2_000e18, 60 days);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAcceptance(id, clientPk, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(InvoiceRegistry.Expired.selector);
        L.registry.acceptInvoiceWithSig(id, client, deadline, sig);
    }

    function test_acceptWithSig_cannotReplay() public {
        uint256 id = _create(2_000e18, 60 days);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signAcceptance(id, clientPk, deadline);
        L.registry.acceptInvoiceWithSig(id, client, deadline, sig);
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.BadStatus.selector, InvoiceStatus.Accepted));
        L.registry.acceptInvoiceWithSig(id, client, deadline, sig);
    }

    function test_openInvoice_firstAcceptorBecomesPayer() public {
        vm.prank(freelancer);
        uint256 id = L.registry.createInvoice(address(0), bytes32(uint256(7)), 500e18, uint64(block.timestamp + 20 days));
        address someone = makeAddr("someone");
        vm.prank(someone);
        L.registry.acceptInvoice(id);
        assertEq(L.registry.getInvoice(id).payer, someone);
    }

    function test_directAccept_wrongPayerReverts() public {
        uint256 id = _create(2_000e18, 60 days);
        vm.prank(makeAddr("intruder"));
        vm.expectRevert(InvoiceRegistry.WrongPayer.selector);
        L.registry.acceptInvoice(id);
    }

    function test_cancel_onlyIssuerAndOnlyIssued() public {
        uint256 id = _create(2_000e18, 60 days);
        vm.prank(client);
        vm.expectRevert(InvoiceRegistry.NotIssuer.selector);
        L.registry.cancelInvoice(id);
        vm.prank(freelancer);
        L.registry.cancelInvoice(id);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Cancelled));

        uint256 id2 = _createAccepted(1_000e18, 30 days);
        vm.prank(freelancer);
        vm.expectRevert(abi.encodeWithSelector(InvoiceRegistry.BadStatus.selector, InvoiceStatus.Accepted));
        L.registry.cancelInvoice(id2);
    }

    function test_markOverdue_onlyAfterDue() public {
        uint256 id = _createAccepted(1_000e18, 30 days);
        vm.expectRevert(InvoiceRegistry.NotYetDue.selector);
        L.registry.markOverdue(id);
        vm.warp(block.timestamp + 31 days);
        L.registry.markOverdue(id);
        assertEq(uint8(_status(id)), uint8(InvoiceStatus.Overdue));
    }

    function test_lateFee_accruesAndCaps() public {
        uint256 id = _createAccepted(10_000e18, 30 days);
        assertEq(L.registry.lateFee(id), 0);
        vm.warp(block.timestamp + 30 days + 1);
        assertEq(L.registry.lateFee(id), 100e18); // 1% for the first started period
        vm.warp(block.timestamp + 16 days);
        assertEq(L.registry.lateFee(id), 200e18);
        vm.warp(block.timestamp + 365 days);
        assertEq(L.registry.lateFee(id), 500e18); // capped at 5%
    }

    function test_dispute_window() public {
        uint256 id = _createAccepted(1_000e18, 30 days);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(InvoiceRegistry.NotParty.selector);
        L.registry.openDispute(id, bytes32("x"));

        vm.warp(block.timestamp + 38 days);
        vm.prank(client);
        vm.expectRevert(InvoiceRegistry.DisputeWindowClosed.selector);
        L.registry.openDispute(id, bytes32("x"));
    }

    function test_onlyModulesCanSetStatus() public {
        uint256 id = _createAccepted(1_000e18, 30 days);
        vm.expectRevert(InvoiceRegistry.NotModule.selector);
        L.registry.setStatus(id, InvoiceStatus.Settled);
        vm.expectRevert(InvoiceRegistry.NotModule.selector);
        L.registry.recordPayment(id, 1);
    }
}
