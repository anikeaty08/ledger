import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { resolveSession } from "./auth.js";
import type { Address } from "viem";

declare module "hono" {
  interface ContextVariableMap {
    sessionAddress: Address | undefined;
  }
}

/** Attaches `sessionAddress` (or undefined) to context. Does not itself reject unauthenticated requests —
 *  routes that require a session check `c.get("sessionAddress")` and 401 themselves, so public routes
 *  in the same router can share this middleware. */
export async function sessionMiddleware(c: Context, next: Next) {
  const token = getCookie(c, "ledger_session");
  const address = await resolveSession(token);
  c.set("sessionAddress", address);
  await next();
}

export function requireSession(c: Context): Address {
  const address = c.get("sessionAddress");
  if (!address) throw new UnauthorizedError();
  return address;
}

export class UnauthorizedError extends Error {}
