import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

export const env = {
  rpcUrl: process.env.RPC_URL ?? "https://rpc.test.mezo.org",
  chainId: Number(process.env.CHAIN_ID ?? 31611),
  invoiceRegistry: process.env.INVOICE_REGISTRY_ADDRESS as `0x${string}` | undefined,
  collectionsManager: process.env.COLLECTIONS_MANAGER_ADDRESS as `0x${string}` | undefined,
  ledgerAccountFactory: process.env.LEDGER_ACCOUNT_FACTORY_ADDRESS as `0x${string}` | undefined,
  keeperPrivateKey: process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 60_000),
  batchSize: Number(process.env.BATCH_SIZE ?? 25),
};

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const v = env[key];
  if (v === undefined) throw new Error(`missing required env var for ${String(key)}`);
  return v as NonNullable<(typeof env)[K]>;
}
