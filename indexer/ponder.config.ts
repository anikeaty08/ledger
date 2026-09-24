import { createConfig } from "ponder";
import { http } from "viem";
import InvoiceRegistryAbi from "./abis/InvoiceRegistry.json" with { type: "json" };
import AdvanceEngineAbi from "./abis/AdvanceEngine.json" with { type: "json" };
import SettlementRouterAbi from "./abis/SettlementRouter.json" with { type: "json" };
import CollectionsManagerAbi from "./abis/CollectionsManager.json" with { type: "json" };
import LedgerAccountFactoryAbi from "./abis/LedgerAccountFactory.json" with { type: "json" };

const address = (name: string): `0x${string}` => {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name} — see indexer/.env.example`);
  return v as `0x${string}`;
};

export default createConfig({
  chains: {
    mezoTestnet: {
      id: 31611,
      rpc: http(process.env.PONDER_RPC_URL_MEZO_TESTNET ?? "https://rpc.test.mezo.org"),
    },
  },
  contracts: {
    InvoiceRegistry: {
      chain: "mezoTestnet",
      abi: InvoiceRegistryAbi,
      address: address("INVOICE_REGISTRY_ADDRESS"),
      startBlock: Number(process.env.INVOICE_REGISTRY_START_BLOCK ?? 0),
    },
    AdvanceEngine: {
      chain: "mezoTestnet",
      abi: AdvanceEngineAbi,
      address: address("ADVANCE_ENGINE_ADDRESS"),
      startBlock: Number(process.env.INVOICE_REGISTRY_START_BLOCK ?? 0),
    },
    SettlementRouter: {
      chain: "mezoTestnet",
      abi: SettlementRouterAbi,
      address: address("SETTLEMENT_ROUTER_ADDRESS"),
      startBlock: Number(process.env.INVOICE_REGISTRY_START_BLOCK ?? 0),
    },
    CollectionsManager: {
      chain: "mezoTestnet",
      abi: CollectionsManagerAbi,
      address: address("COLLECTIONS_MANAGER_ADDRESS"),
      startBlock: Number(process.env.INVOICE_REGISTRY_START_BLOCK ?? 0),
    },
    LedgerAccountFactory: {
      chain: "mezoTestnet",
      abi: LedgerAccountFactoryAbi,
      address: address("LEDGER_ACCOUNT_FACTORY_ADDRESS"),
      startBlock: Number(process.env.INVOICE_REGISTRY_START_BLOCK ?? 0),
    },
  },
});
