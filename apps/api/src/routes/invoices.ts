import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/pool.js";
import { requireSession } from "../lib/session-middleware.js";
import { ensureMerchant } from "../lib/merchants.js";
import { storeInvoiceBlob, getInvoiceBlob, CommitmentMismatchError } from "../lib/blobs.js";
import { reconcileInvoice, readInvoice, isIssuer } from "../lib/reconcile.js";
import { InvoiceIdSchema, Bytes32Schema } from "../lib/validation.js";

export const invoiceRoutes = new Hono();

const STALE_AFTER_MS = 30_000;

const StoreInvoiceMetadata = z.object({
  invoiceId: z.coerce.bigint(),
  payerHint: z.string().max(255).optional(),
  ciphertext: z.string().min(1), // base64 AES-GCM ciphertext
  iv: z.string().min(1), // base64 IV
  commitment: Bytes32Schema, // must equal keccak256(ciphertext) and the on-chain commitment
});

// POST /api/v1/invoices — store encrypted terms after the on-chain create tx (session required).
// Only the invoice's on-chain issuer may store terms, and only terms whose commitment matches the chain,
// so nobody can overwrite another merchant's invoice. The decryption key is never sent here.
invoiceRoutes.post("/", async (c) => {
  const session = requireSession(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = StoreInvoiceMetadata.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const onChain = await readInvoice(parsed.data.invoiceId);
  if (onChain.issuer === "0x0000000000000000000000000000000000000000") {
    return c.json({ error: "invoice not found on-chain" }, 404);
  }
  if (!isIssuer(onChain, session)) return c.json({ error: "only the invoice's issuer can store its terms" }, 403);
  if (onChain.commitment.toLowerCase() !== parsed.data.commitment.toLowerCase()) {
    return c.json({ error: "commitment does not match the on-chain invoice" }, 400);
  }

  try {
    await ensureMerchant(session);
    await storeInvoiceBlob({
      invoiceId: parsed.data.invoiceId,
      issuer: session,
      payerHint: parsed.data.payerHint,
      ciphertextB64: parsed.data.ciphertext,
      ivB64: parsed.data.iv,
      commitment: parsed.data.commitment,
    });
  } catch (err) {
    if (err instanceof CommitmentMismatchError) return c.json({ error: err.message }, 400);
    throw err;
  }
  await reconcileInvoice(parsed.data.invoiceId, undefined, onChain);

  return c.json({ ok: true, invoiceId: parsed.data.invoiceId.toString() }, 201);
});

// GET /api/v1/invoices — the signed-in merchant's invoices. Rows older than 30s are re-read from the
// chain first, so a just-accepted or just-paid invoice shows its real status.
invoiceRoutes.get("/", async (c) => {
  const issuer = requireSession(c);
  const statusFilter = c.req.query("status");
  const rows = await db
    .selectFrom("invoice_cache")
    .selectAll()
    .where("issuer", "=", issuer)
    .orderBy("invoice_id", "desc")
    .limit(100)
    .execute();

  const now = Date.now();
  const stale = rows.filter((r) => now - r.updated_at.getTime() > STALE_AFTER_MS);
  const refreshed = new Map(
    (await Promise.all(stale.map((r) => reconcileInvoice(BigInt(r.invoice_id)).catch(() => null))))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => [r.invoice_id, r]),
  );

  let result = rows.map((r) => ({ ...r, ...(refreshed.get(r.invoice_id) ?? {}) }));
  if (statusFilter !== undefined && /^[0-9]+$/.test(statusFilter)) {
    result = result.filter((r) => r.status === Number(statusFilter));
  }
  return c.json(result.map(serializeCacheRow));
});

// GET /api/v1/invoices/:id — ciphertext plus cached chain status. Public: the pay page needs this
// without a session, and only the ciphertext (never plaintext terms) is returned.
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

// POST /api/v1/invoices/:id/reconcile — re-read this invoice from the chain now (session required), so
// the UI can refresh right after a transaction instead of waiting for the list's staleness window.
invoiceRoutes.post("/:id/reconcile", async (c) => {
  requireSession(c);
  const parsed = InvoiceIdSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.json({ error: "invalid invoice id" }, 400);
  const body = ReconcileRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: body.error.flatten() }, 400);

  const row = await reconcileInvoice(parsed.data, body.data.txHash);
  if (!row) return c.json({ error: "invoice not found on-chain" }, 404);
  return c.json(serializeCacheRow(row));
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
