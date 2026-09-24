import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { env } from "../lib/env.js";

export interface MerchantRow {
  address: string;
  display_name: string | null;
  email: string | null;
  telegram_handle: string | null;
  created_at: Date;
}

export interface InvoiceBlobRow {
  invoice_id: string; // bigint comes back as string from pg
  issuer: string;
  payer_hint: string | null;
  ciphertext: string;
  iv: string;
  commitment: string;
  created_at: Date;
}

export interface InvoiceCacheRow {
  invoice_id: string;
  issuer: string;
  payer: string | null;
  amount: string;
  paid: string;
  due_date: Date;
  status: number;
  financed: boolean;
  tx_hash: string | null;
  updated_at: Date;
}

export interface SplitRow {
  split_id: string;
  owner: string;
  label: string | null;
  recipients: unknown;
  splitter_addr: string | null;
  created_at: Date;
}

export interface AuthChallengeRow {
  id: string;
  address: string;
  origin: string;
  nonce: string;
  issued_at: Date;
  expires_at: Date;
  consumed: boolean;
}

export interface SessionRow {
  token_hash: string;
  address: string;
  created_at: Date;
  expires_at: Date;
}

export interface CheckoutSessionRow {
  id: string;
  invoice_id: string;
  return_url: string | null;
  status: string;
  created_at: Date;
  expires_at: Date;
}

export interface Database {
  merchants: MerchantRow;
  invoice_blobs: InvoiceBlobRow;
  invoice_cache: InvoiceCacheRow;
  splits: SplitRow;
  auth_challenges: AuthChallengeRow;
  sessions: SessionRow;
  checkout_sessions: CheckoutSessionRow;
}

const pgPool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });

pgPool.on("error", (err) => {
  // A background idle-client error must never crash the process.
  console.error("[pg] idle client error", err);
});

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: pgPool }),
});

export async function closeDb(): Promise<void> {
  await pgPool.end();
}
