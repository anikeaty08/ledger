import { Hono } from "hono";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "../db/pool.js";
import { requireSession } from "../lib/session-middleware.js";
import { InvoiceIdSchema, Bytes32Schema } from "../lib/validation.js";

export const checkoutRoutes = new Hono();

const CreateCheckout = z.object({
  invoiceId: z.coerce.bigint(),
  returnUrl: z.string().url().optional(),
  ttlMinutes: z.number().int().positive().max(60 * 24).default(60),
});

// POST /api/v1/checkout-sessions — create a hosted checkout (session or API key).
checkoutRoutes.post("/", async (c) => {
  requireSession(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateCheckout.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = nanoid();
  const expiresAt = new Date(Date.now() + parsed.data.ttlMinutes * 60_000);
  await db
    .insertInto("checkout_sessions")
    .values({
      id,
      invoice_id: parsed.data.invoiceId.toString(),
      return_url: parsed.data.returnUrl ?? null,
      status: "pending",
      created_at: new Date(),
      expires_at: expiresAt,
    })
    .execute();

  return c.json({ id, invoiceId: parsed.data.invoiceId.toString(), expiresAt: expiresAt.toISOString() }, 201);
});

// GET /api/v1/checkout-sessions/:id — resolve a hosted checkout (public: the payer has no session yet).
checkoutRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await db.selectFrom("checkout_sessions").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) return c.json({ error: "not found" }, 404);
  const expired = row.status === "pending" && row.expires_at.getTime() < Date.now();
  return c.json({
    id: row.id,
    invoiceId: row.invoice_id,
    returnUrl: row.return_url,
    status: expired ? "expired" : row.status,
    expiresAt: row.expires_at.toISOString(),
  });
});

const ReconcileCheckout = z.object({ txHash: Bytes32Schema });

// POST /api/v1/checkout-sessions/:id/reconcile — verify and reconcile a submitted payment
// (public: this is the payer's own handoff after paying on-chain).
checkoutRoutes.post("/:id/reconcile", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = ReconcileCheckout.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const row = await db.selectFrom("checkout_sessions").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) return c.json({ error: "not found" }, 404);

  // The real check happens in the indexer/keeper: it confirms `txHash` is a successful InvoicePaid
  // event for this invoiceId, then flips invoice_cache.status. Here we just record the claim and let
  // the caller re-poll GET /:id — we never mark "paid" purely from a client-supplied tx hash.
  await db
    .updateTable("checkout_sessions")
    .set({ status: "pending" }) // stays pending until the indexer confirms the event
    .where("id", "=", id)
    .execute();

  return c.json({ id, txHash: parsed.data.txHash, status: "verifying" });
});
