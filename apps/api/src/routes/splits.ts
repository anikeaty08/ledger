import { Hono } from "hono";
import { z } from "zod";
import { keccak256, encodeAbiParameters, type Address } from "viem";
import { db } from "../db/pool.js";
import { requireSession } from "../lib/session-middleware.js";
import { ensureMerchant } from "../lib/merchants.js";
import { AddressSchema } from "../lib/validation.js";

export const splitRoutes = new Hono();

const RecipientSchema = z.object({ address: AddressSchema, bps: z.number().int().positive().max(10_000) });
const CreateSplit = z.object({
  label: z.string().max(120).optional(),
  recipients: z.array(RecipientSchema).min(1).max(20),
});

function splitId(recipients: { address: Address; bps: number }[]): `0x${string}` {
  // Mirrors SplitterFactory.salt(recipients, bps): keccak256(abi.encode(address[], uint16[]))
  const addresses = recipients.map((r) => r.address);
  const bps = recipients.map((r) => r.bps);
  const encoded = encodeAbiParameters(
    [{ type: "address[]" }, { type: "uint16[]" }],
    [addresses, bps],
  );
  return keccak256(encoded);
}

// POST /api/v1/splits — define a reusable payout split for this merchant (session required).
splitRoutes.post("/", async (c) => {
  const owner = requireSession(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateSplit.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const totalBps = parsed.data.recipients.reduce((sum, r) => sum + r.bps, 0);
  if (totalBps !== 10_000) return c.json({ error: `recipients must sum to 10000 bps, got ${totalBps}` }, 400);

  const id = splitId(parsed.data.recipients);
  await ensureMerchant(owner);
  await db
    .insertInto("splits")
    .values({
      split_id: id,
      owner,
      label: parsed.data.label ?? null,
      recipients: JSON.stringify(parsed.data.recipients),
      splitter_addr: null, // filled in once SplitterFactory.getOrCreate is called on-chain
      created_at: new Date(),
    })
    .onConflict((oc) => oc.column("split_id").doNothing())
    .execute();

  return c.json({ splitId: id, recipients: parsed.data.recipients }, 201);
});

// GET /api/v1/splits — list this merchant's saved splits.
splitRoutes.get("/", async (c) => {
  const owner = requireSession(c);
  const rows = await db.selectFrom("splits").selectAll().where("owner", "=", owner).execute();
  return c.json(
    rows.map((r) => ({
      splitId: r.split_id,
      label: r.label,
      recipients: r.recipients,
      splitterAddress: r.splitter_addr,
    })),
  );
});
