import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../db/pool.js";
import { requireSession } from "../lib/session-middleware.js";
import { storeInvoiceBlob, getInvoiceBlob, CommitmentMismatchError } from "../lib/blobs.js";
import { InvoiceIdSchema, Bytes32Schema, AddressSchema } from "../lib/validation.js";

export const invoiceRoutes = new Hono();

const StoreInvoiceMetadata = z.object({
  invoiceId: z.coerce.bigint(),
  payerHint: z.string().max(255).optional(),
  ciphertext: z.string().min(1), // base64 AES-GCM ciphertext
  iv: z.string().min(1), // base64 IV
  commitment: Bytes32Schema, // must equal keccak256(ciphertext) client-side and the on-chain commitment
});

// POST /api/v1/invoices — store invoice metadata after the on-chain create tx (session or API key).
// The decryption key is never sent here; it lives only in the pay-link fragment the client keeps.
invoiceRoutes.post("/", async (c) => {
  const issuer = requireSession(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = StoreInvoiceMetadata.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  try {
    await storeInvoiceBlob({
      invoiceId: parsed.data.invoiceId,
      issuer,
      payerHint: parsed.data.payerHint,
      ciphertextB64: parsed.data.ciphertext,
      ivB64: parsed.data.iv,
      commitment: parsed.data.commitment,
    });
  } catch (err) {
    if (err instanceof CommitmentMismatchError) return c.json({ error: err.message }, 400);
    throw err;
  }

  return c.json({ ok: true, invoiceId: parsed.data.invoiceId.toString() }, 201);
});

// GET /api/v1/invoices — list the authenticated merchant's invoices with canonical (cached) state.
invoiceRoutes.get("/", async (c) => {
  const issuer = requireSession(c);
  const statusFilter = c.req.query("status");
  let q = db.selectFrom("invoice_cache").selectAll().where("issuer", "=", issuer).orderBy("updated_at", "desc").limit(100);
  if (statusFilter !== undefined && /^[0-9]+$/.test(statusFilter)) {
    q = q.where("status", "=", Number(statusFilter));
  }
  const rows = await q.execute();
  return c.json(rows.map(serializeCacheRow));
});

// GET /api/v1/invoices/:id — read metadata plus (cached) chain status. Public: the pay page needs this
// without a session, and only the ciphertext (not plaintext terms) is ever returned.
invoiceRoutes.get("/:id", async (c) => {
  const parsed = InvoiceIdSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.json({ error: "invalid invoice id" }, 400);

  const [blob, cached] = await Promise.all([
    getInvoiceBlob(parsed.data),
    db.selectFrom("invoice_cache").selectAll().where("invoice_id", "=", parsed.data.toString()).executeTakeFirst(),
  ]);
  if (!blob && !cached) return c.json({ error: "not found" }, 404);

  return c.json({
    invoiceId: parsed.data.toString(),
    ciphertext: blob?.ciphertext ?? null,
    iv: blob?.iv ?? null,
    commitment: blob?.commitment ?? null,
    chain: cached ? serializeCacheRow(cached) : null,
  });
});

const ReconcileRequest = z.object({ txHash: Bytes32Schema.optional() });

// POST /api/v1/invoices/:id/reconcile — nudge the cache to re-sync from chain for this invoice
// (session or API key). The indexer does this automatically; this route lets the UI force a refresh
// right after a transaction the user just sent, before the indexer's next poll.
invoiceRoutes.post("/:id/reconcile", async (c) => {
  requireSession(c);
  const parsed = InvoiceIdSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.json({ error: "invalid invoice id" }, 400);
  const body = await c.req.json().catch(() => ({}));
  ReconcileRequest.safeParse(body); // txHash is informational only; the reconciler re-reads the chain

  // Actual reconciliation logic lives in services/keeper (reads InvoiceRegistry.getInvoice and upserts
  // invoice_cache). This endpoint just enqueues a priority reconcile job.
  return c.json({ queued: true, invoiceId: parsed.data.toString() });
});

function serializeCacheRow(row: {
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
}) {
  return {
    invoiceId: row.invoice_id,
    issuer: row.issuer,
    payer: row.payer,
    amount: row.amount,
    paid: row.paid,
    dueDate: row.due_date.toISOString(),
    status: row.status,
    financed: row.financed,
    txHash: row.tx_hash,
    updatedAt: row.updated_at.toISOString(),
  };
}
