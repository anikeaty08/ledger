import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./lib/env.js";
import { sessionMiddleware, UnauthorizedError } from "./lib/session-middleware.js";
import { authRoutes } from "./routes/auth.js";
import { merchantRoutes } from "./routes/merchants.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { chainRoutes } from "./routes/chain.js";
import { relayRoutes } from "./routes/relay.js";
import { splitRoutes } from "./routes/splits.js";
import { checkoutRoutes } from "./routes/checkout.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  }),
);
app.use("*", sessionMiddleware);

app.onError((err, c) => {
  if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
  console.error("[api] unhandled error", err);
  return c.json({ error: "internal error" }, 500);
});

app.get("/health", (c) => c.json({ ok: true, env: env.NODE_ENV }));

const v1 = new Hono();
v1.route("/auth", authRoutes);
v1.route("/merchants", merchantRoutes);
v1.route("/invoices", invoiceRoutes);
v1.route("/chain", chainRoutes);
v1.route("/relay", relayRoutes);
v1.route("/splits", splitRoutes);
v1.route("/checkout-sessions", checkoutRoutes);

app.route("/api/v1", v1);

const port = env.PORT;
console.log(`[api] listening on :${port} (${env.NODE_ENV}, chain ${env.CHAIN_ID})`);
serve({ fetch: app.fetch, port });
