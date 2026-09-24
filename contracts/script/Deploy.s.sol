// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LedgerDeployer} from "./LedgerDeployer.sol";

/// @notice Deploys and wires the full Ledger suite to Mezo testnet (or any EVM chain with the right
///         External addresses configured). Writes the resulting addresses to
///         `deployments/<chainid>.json` for the API/keeper/frontend to consume.
///
/// Usage (Mezo testnet):
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url mezo_testnet --broadcast --slow \
///     --private-key $DEPLOYER_PRIVATE_KEY
///
/// All external Mezo addresses are read from env vars so the same script works on testnet, mainnet, or
/// a local fork without editing source. See `.env.example` at the repo root for the full list.
contract Deploy is Script, LedgerDeployer {
    function run() external {
        address deployer = vm.envOr("OWNER_ADDRESS", msg.sender);
        External memory ext = External({
            musd: vm.envAddress("MUSD_ADDRESS"),
            btcToken: vm.envAddress("BTC_TOKEN_ADDRESS"),
            wrapNative: vm.envOr("BTC_WRAP_NATIVE", false),
            priceFeed: vm.envAddress("PRICE_FEED_ADDRESS"),
            mezoRouter: vm.envAddress("MEZO_ROUTER_ADDRESS"),
            poolFactory: vm.envAddress("POOL_FACTORY_ADDRESS"),
            stablePool: vm.envOr("BTC_MUSD_STABLE_POOL", false),
            borrowerOperations: vm.envAddress("BORROWER_OPERATIONS_ADDRESS"),
            troveManager: vm.envAddress("TROVE_MANAGER_ADDRESS"),
            resolver: vm.envOr("RESOLVER_ADDRESS", deployer),
            treasury: vm.envOr("TREASURY_ADDRESS", deployer)
        });

        vm.startBroadcast();
        Suite memory s = _deployLedger(deployer, ext);
        vm.stopBroadcast();

        console2.log("InvoiceRegistry       ", address(s.registry));
        console2.log("ReceivableNFT         ", address(s.receivable));
        console2.log("ReputationRegistry    ", address(s.reputation));
        console2.log("CreditPolicy          ", address(s.policy));
        console2.log("SeniorVault (lsMUSD)  ", address(s.senior));
        console2.log("JuniorVault (ljMUSD)  ", address(s.junior));
        console2.log("BTCSwapper            ", address(s.swapper));
        console2.log("AdvanceEngine         ", address(s.engine));
        console2.log("LedgerAccountFactory  ", address(s.accounts));
        console2.log("SettlementRouter      ", address(s.router));
        console2.log("CollectionsManager    ", address(s.collections));
        console2.log("SplitterFactory       ", address(s.splitters));

        _writeDeploymentJson(s, ext);
    }

    function _writeDeploymentJson(Suite memory s, External memory ext) internal {
        string memory dir = string.concat(vm.projectRoot(), "/deployments");
        string memory path = string.concat(dir, "/", vm.toString(block.chainid), ".json");

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "musd", ext.musd);
        vm.serializeAddress(json, "invoiceRegistry", address(s.registry));
        vm.serializeAddress(json, "receivableNft", address(s.receivable));
        vm.serializeAddress(json, "reputationRegistry", address(s.reputation));
        vm.serializeAddress(json, "creditPolicy", address(s.policy));
        vm.serializeAddress(json, "seniorVault", address(s.senior));
        vm.serializeAddress(json, "juniorVault", address(s.junior));
        vm.serializeAddress(json, "btcSwapper", address(s.swapper));
        vm.serializeAddress(json, "advanceEngine", address(s.engine));
        vm.serializeAddress(json, "ledgerAccountFactory", address(s.accounts));
        vm.serializeAddress(json, "settlementRouter", address(s.router));
        vm.serializeAddress(json, "collectionsManager", address(s.collections));
        string memory finalJson = vm.serializeAddress(json, "splitterFactory", address(s.splitters));

        vm.createDir(dir, true);
        vm.writeJson(finalJson, path);
        console2.log("Wrote deployment addresses to", path);
    }
}
