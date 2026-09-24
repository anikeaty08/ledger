import "dotenv/config";
import { z } from "zod";

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "expected a 0x-prefixed 20-byte address")
  .transform((s) => s.toLowerCase() as `0x${string}`)
  .optional();

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  CHAIN_ID: z.coerce.number().int().positive().default(31611),
  RPC_URL: z.string().url().default("https://rpc.test.mezo.org"),
  EXPLORER_URL: z.string().url().default("https://explorer.test.mezo.org"),

  INVOICE_REGISTRY_ADDRESS: AddressSchema,
  RECEIVABLE_NFT_ADDRESS: AddressSchema,
  ADVANCE_ENGINE_ADDRESS: AddressSchema,
  SETTLEMENT_ROUTER_ADDRESS: AddressSchema,
  REPUTATION_REGISTRY_ADDRESS: AddressSchema,
  CREDIT_POLICY_ADDRESS: AddressSchema,
  SENIOR_VAULT_ADDRESS: AddressSchema,
  JUNIOR_VAULT_ADDRESS: AddressSchema,
  BTC_SWAPPER_ADDRESS: AddressSchema,
  LEDGER_ACCOUNT_FACTORY_ADDRESS: AddressSchema,
  COLLECTIONS_MANAGER_ADDRESS: AddressSchema,
  SPLITTER_FACTORY_ADDRESS: AddressSchema,
  MUSD_ADDRESS: AddressSchema,

  RELAYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .transform((s) => s as `0x${string}`)
    .optional(),

  DATABASE_URL: z.string().default("postgres://ledger:ledger@localhost:5432/ledger"),
  BLOB_INTEGRITY_SECRET: z.string().default("dev-only-insecure-secret-change-me"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.BLOB_INTEGRITY_SECRET.startsWith("dev-only")) {
    throw new Error("BLOB_INTEGRITY_SECRET must be set to a real secret in production");
  }
  return env;
}

export const env = loadEnv();
