import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { AddressSchema, HexSchema } from "../lib/validation.js";
import { createChallenge, verifyChallengeAndCreateSession, resolveSession, revokeSession, AuthError } from "../lib/auth.js";
import { env } from "../lib/env.js";

export const authRoutes = new Hono();

const SESSION_COOKIE = "ledger_session";

const ChallengeRequest = z.object({ address: AddressSchema });

// POST /api/v1/auth/challenges — origin-bound wallet challenge, public.
authRoutes.post("/challenges", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ChallengeRequest.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid address" }, 400);

  const origin = c.req.header("origin") ?? env.WEB_ORIGIN;
  const { id, message, expiresAt } = await createChallenge(parsed.data.address, origin);
  return c.json({ challengeId: id, message, expiresAt: expiresAt.toISOString() });
});

const SessionRequest = z.object({ challengeId: z.string().min(1), signature: HexSchema });

// POST /api/v1/auth/sessions — verify signature, create session (signed challenge required).
authRoutes.post("/sessions", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SessionRequest.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid request" }, 400);

  try {
    const { token, address, expiresAt } = await verifyChallengeAndCreateSession(
      parsed.data.challengeId,
      parsed.data.signature,
    );
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: env.NODE_ENV === "production",
      expires: expiresAt,
      path: "/",
    });
    return c.json({ address });
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.message }, 401);
    throw err;
  }
});

// GET /api/v1/auth/session — inspect current wallet session (session cookie).
authRoutes.get("/session", async (c) => {
  const token = getCookieValue(c.req.header("cookie"), SESSION_COOKIE);
  const address = await resolveSession(token);
  if (!address) return c.json({ address: null }, 200);
  return c.json({ address });
});

// DELETE /api/v1/auth/session — revoke current session (session cookie).
authRoutes.delete("/session", async (c) => {
  const token = getCookieValue(c.req.header("cookie"), SESSION_COOKIE);
  if (token) await revokeSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.body(null, 204);
});

function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

export { SESSION_COOKIE };
