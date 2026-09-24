import { Hono } from "hono";
import { publicClient, requireAddress } from "../lib/chain.js";
import { env } from "../lib/env.js";
import { invoiceRegistryAbi, advanceEngineAbi, settlementRouterAbi } from "../lib/abi.js";
import { InvoiceIdSchema } from "../lib/validation.js";

/**
 * Read-only chain views. These never cache stale money-relevant numbers behind writes — every route
 * here reads the chain directly on each call. (Listings use the indexed cache; see routes/invoices.ts.)
 */
export const chainRoutes = new Hono();

chainRoutes.get("/status", async (c) => {
  const [blockNumber, chainId] = await Promise.all([publicClient.getBlockNumber(), publicClient.getChainId()]);
  return c.json({ chainId, blockNumber: blockNumber.toString(), rpcUrl: env.RPC_URL });
});

chainRoutes.get("/contracts", (c) =>
  c.json({
    invoiceRegistry: env.INVOICE_REGISTRY_ADDRESS,
    receivableNft: env.RECEIVABLE_NFT_ADDRESS,
    advanceEngine: env.ADVANCE_ENGINE_ADDRESS,
    settlementRouter: env.SETTLEMENT_ROUTER_ADDRESS,
    reputationRegistry: env.REPUTATION_REGISTRY_ADDRESS,
    creditPolicy: env.CREDIT_POLICY_ADDRESS,
    seniorVault: env.SENIOR_VAULT_ADDRESS,
    juniorVault: env.JUNIOR_VAULT_ADDRESS,
    btcSwapper: env.BTC_SWAPPER_ADDRESS,
    ledgerAccountFactory: env.LEDGER_ACCOUNT_FACTORY_ADDRESS,
    collectionsManager: env.COLLECTIONS_MANAGER_ADDRESS,
    splitterFactory: env.SPLITTER_FACTORY_ADDRESS,
    musd: env.MUSD_ADDRESS,
  }),
);

chainRoutes.get("/invoices/:id", async (c) => {
  const parsed = InvoiceIdSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.json({ error: "invalid invoice id" }, 400);

  const address = requireAddress("INVOICE_REGISTRY_ADDRESS", env.INVOICE_REGISTRY_ADDRESS);
  const [invoice, owed] = await Promise.all([
    publicClient.readContract({
      address,
      abi: invoiceRegistryAbi,
      functionName: "getInvoice",
      args: [parsed.data],
    }),
    publicClient.readContract({
      address,
      abi: invoiceRegistryAbi,
      functionName: "amountOwed",
      args: [parsed.data],
    }),
  ]);

  return c.json(serializeBigints({ invoice, amountOwed: owed }));
});

chainRoutes.get("/invoices/:id/quote", async (c) => {
  const parsed = InvoiceIdSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.json({ error: "invalid invoice id" }, 400);

  const address = requireAddress("ADVANCE_ENGINE_ADDRESS", env.ADVANCE_ENGINE_ADDRESS);
  const quote = await publicClient.readContract({
    address,
    abi: advanceEngineAbi,
    functionName: "quote",
    args: [parsed.data],
  });
  return c.json(serializeBigints({ quote }));
});

chainRoutes.get("/invoices/:id/preview-payment", async (c) => {
  const idParsed = InvoiceIdSchema.safeParse(c.req.param("id"));
  const amountParsed = /^[0-9]+$/.test(c.req.query("amount") ?? "") ? BigInt(c.req.query("amount")!) : undefined;
  if (!idParsed.success || amountParsed === undefined) return c.json({ error: "invalid request" }, 400);

  const address = requireAddress("SETTLEMENT_ROUTER_ADDRESS", env.SETTLEMENT_ROUTER_ADDRESS);
  const [used, toVaults, remainder] = await publicClient.readContract({
    address,
    abi: settlementRouterAbi,
    functionName: "previewPayment",
    args: [idParsed.data, amountParsed],
  });
  return c.json({ used: used.toString(), toVaults: toVaults.toString(), remainder: remainder.toString() });
});

/** Recursively stringifies bigints so JSON.stringify doesn't throw on raw chain reads. */
function serializeBigints<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigints);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeBigints(v)]));
  }
  return value;
}
