// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {LedgerDeployer} from "../script/LedgerDeployer.sol";
import {MockMUSD, MockBTC, MockPriceFeed, MockRouter, MockMezoCDP, MockSavingsVault} from "./mocks/Mocks.sol";
import {Invoice, InvoiceStatus} from "../src/libraries/Types.sol";
import {AdvanceEngine} from "../src/credit/AdvanceEngine.sol";

abstract contract BaseTest is Test, LedgerDeployer {
    MockMUSD internal musd;
    MockBTC internal btc;
    MockPriceFeed internal feed;
    MockRouter internal mezoRouter;
    MockMezoCDP internal cdp;
    MockSavingsVault internal savings;
    Suite internal L;

    address internal owner = makeAddr("owner");
    address internal resolver = makeAddr("resolver");
    address internal treasury = makeAddr("treasury");
    address internal freelancer = makeAddr("freelancer");
    address internal lpSenior = makeAddr("lpSenior");
    address internal lpJunior = makeAddr("lpJunior");
    address internal keeper = makeAddr("keeper");
    uint256 internal clientPk = 0xC11E47;
    address internal client;

    uint256 internal constant BTC_PRICE = 60_000e18;

    function setUp() public virtual {
        client = vm.addr(clientPk);
        musd = new MockMUSD();
        btc = new MockBTC();
        feed = new MockPriceFeed(BTC_PRICE);
        mezoRouter = new MockRouter(feed, musd, btc);
        cdp = new MockMezoCDP(musd, feed);
        savings = new MockSavingsVault(musd);

        External memory ext = External({
            musd: address(musd),
            btcToken: address(btc),
            wrapNative: true,
            priceFeed: address(feed),
            mezoRouter: address(mezoRouter),
            poolFactory: address(0xFAC),
            stablePool: false,
            borrowerOperations: address(cdp),
            troveManager: address(cdp),
            resolver: resolver,
            treasury: treasury
        });
        vm.startPrank(owner);
        L = _deployLedger(owner, ext);
        vm.stopPrank();

        _seedVault(lpSenior, address(L.senior), 80_000e18);
        _seedVault(lpJunior, address(L.junior), 20_000e18);

        vm.deal(freelancer, 100 ether);
        vm.deal(client, 100 ether);
        musd.mint(client, 1_000_000e18);
        vm.prank(client);
        musd.approve(address(L.router), type(uint256).max);
    }

    // ───────────────────────────── helpers ─────────────────────────────

    function _seedVault(address lp, address vault, uint256 amount) internal {
        musd.mint(lp, amount);
        vm.startPrank(lp);
        musd.approve(vault, amount);
        (bool ok,) = vault.call(abi.encodeWithSignature("deposit(uint256,address)", amount, lp));
        require(ok, "deposit failed");
        vm.stopPrank();
    }

    function _create(uint128 amount, uint64 tenor) internal returns (uint256 id) {
        vm.prank(freelancer);
        id = L.registry.createInvoice(client, keccak256(abi.encode("terms", amount, tenor)), amount, uint64(block.timestamp) + tenor);
    }

    function _signAcceptance(uint256 id, uint256 pk, uint256 deadline) internal view returns (bytes memory) {
        bytes32 digest = L.registry.acceptanceDigest(id, vm.addr(pk), deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _accept(uint256 id) internal {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory sig = _signAcceptance(id, clientPk, deadline);
        vm.prank(keeper); // relayer submits; client pays no gas
        L.registry.acceptInvoiceWithSig(id, client, deadline, sig);
    }

    function _createAccepted(uint128 amount, uint64 tenor) internal returns (uint256 id) {
        id = _create(amount, tenor);
        _accept(id);
    }

    function _advance(uint256 id, uint256 amount, uint256 recourseMUSD, uint256 recourseBTC) internal {
        musd.mint(freelancer, recourseMUSD);
        vm.startPrank(freelancer);
        musd.approve(address(L.engine), recourseMUSD);
        L.receivable.approve(address(L.engine), id);
        L.engine.requestAdvance{value: recourseBTC}(id, amount, type(uint256).max, recourseMUSD);
        vm.stopPrank();
    }

    function _status(uint256 id) internal view returns (InvoiceStatus) {
        return L.registry.getInvoice(id).status;
    }

    function _adv(uint256 id) internal view returns (AdvanceEngine.Advance memory) {
        return L.engine.getAdvance(id);
    }

    /// Build a Gold-tier payer: settle on time with 4 distinct issuers and ≥100k volume.
    function _makeGold(address payer, uint256 payerPk) internal {
        for (uint256 i; i < 4; ++i) {
            address issuer = makeAddr(string.concat("goldIssuer", vm.toString(i)));
            vm.prank(issuer);
            uint256 id = L.registry.createInvoice(payer, bytes32(i + 1), 30_000e18, uint64(block.timestamp + 30 days));
            uint256 deadline = block.timestamp + 1 days;
            bytes32 digest = L.registry.acceptanceDigest(id, payer, deadline);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerPk, digest);
            L.registry.acceptInvoiceWithSig(id, payer, deadline, abi.encodePacked(r, s, v));
            musd.mint(payer, 30_000e18);
            vm.startPrank(payer);
            musd.approve(address(L.router), type(uint256).max);
            L.router.pay(id, 30_000e18);
            vm.stopPrank();
        }
    }
}
