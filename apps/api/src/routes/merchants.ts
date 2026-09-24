import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/pool.js";
import { requireSession } from "../lib/session-middleware.js";

export const merchantRoutes = new Hono();

const CreateMerchant = z.object({
  displayName: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  telegramHandle: z.string().max(64).optional(),
});

// POST /api/v1/merchants — create a wallet-bound merchant (session cookie required).
merchantRoutes.post("/", async (c) => {
  const address = requireSession(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = CreateMerchant.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await db
    .insertInto("merchants")
    .values({
      address,
      display_name: parsed.data.displayName ?? null,
      email: parsed.data.email ?? null,
      telegram_handle: parsed.data.telegramHandle ?? null,
      created_at: new Date(),
    })
    .onConflict((oc) =>
      oc.column("address").doUpdateSet({
        display_name: (eb) => eb.ref("excluded.display_name"),
        email: (eb) => eb.ref("excluded.email"),
        telegram_handle: (eb) => eb.ref("excluded.telegram_handle"),
      }),
    )
    .execute();

  const merchant = await db.selectFrom("merchants").selectAll().where("address", "=", address).executeTakeFirst();
  return c.json(merchant);
});
