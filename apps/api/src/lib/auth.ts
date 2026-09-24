import { nanoid } from "nanoid";
import { createHash, randomBytes } from "node:crypto";
import { verifyMessage, type Address } from "viem";
import { db } from "../db/pool.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function challengeMessage(params: {
  address: Address;
  origin: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}): string {
  // A human-readable, unambiguous message the wallet signs. Binding address + origin + nonce + times
  // prevents replay across sessions, sites, and time windows (see docs/SYSTEM_DESIGN.md §16).
  return [
    "Ledger wants you to sign in.",
    "",
    `Address: ${params.address}`,
    `Origin: ${params.origin}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expires At: ${params.expiresAt}`,
    "",
    "This request will not trigger a blockchain transaction or cost any gas.",
  ].join("\n");
}

export async function createChallenge(address: Address, origin: string) {
  const id = nanoid();
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);

  await db
    .insertInto("auth_challenges")
    .values({
      id,
      address: address.toLowerCase(),
      origin,
      nonce,
      issued_at: issuedAt,
      expires_at: expiresAt,
      consumed: false,
    })
    .execute();

  const message = challengeMessage({
    address,
    origin,
    nonce,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  return { id, message, expiresAt };
}

export class AuthError extends Error {}

/** Verifies the signature, consumes the challenge exactly once, and opens a session. */
export async function verifyChallengeAndCreateSession(
  challengeId: string,
  signature: `0x${string}`,
): Promise<{ token: string; address: Address; expiresAt: Date }> {
  const challenge = await db
    .selectFrom("auth_challenges")
    .selectAll()
    .where("id", "=", challengeId)
    .executeTakeFirst();

  if (!challenge) throw new AuthError("unknown challenge");
  if (challenge.consumed) throw new AuthError("challenge already used");
  if (challenge.expires_at.getTime() < Date.now()) throw new AuthError("challenge expired");

  const address = challenge.address as Address;
  const message = challengeMessage({
    address,
    origin: challenge.origin,
    nonce: challenge.nonce,
    issuedAt: challenge.issued_at.toISOString(),
    expiresAt: challenge.expires_at.toISOString(),
  });

  // Supports both EOA (ECDSA) and smart-contract wallets (EIP-1271) — `verifyMessage` checks both.
  const valid = await verifyMessage({ address, message, signature }).catch(() => false);
  if (!valid) throw new AuthError("invalid signature");

  // Consume atomically: a concurrent second verify for the same challenge must fail.
  const consumed = await db
    .updateTable("auth_challenges")
    .set({ consumed: true })
    .where("id", "=", challengeId)
    .where("consumed", "=", false)
    .executeTakeFirst();
  if (Number(consumed.numUpdatedRows ?? 0) === 0) throw new AuthError("challenge already used");

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db
    .insertInto("sessions")
    .values({ token_hash: tokenHash, address, created_at: new Date(), expires_at: expiresAt })
    .execute();

  return { token, address, expiresAt };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function resolveSession(token: string | undefined): Promise<Address | undefined> {
  if (!token) return undefined;
  const row = await db
    .selectFrom("sessions")
    .selectAll()
    .where("token_hash", "=", hashToken(token))
    .executeTakeFirst();
  if (!row) return undefined;
  if (row.expires_at.getTime() < Date.now()) return undefined;
  return row.address as Address;
}

export async function revokeSession(token: string): Promise<void> {
  await db.deleteFrom("sessions").where("token_hash", "=", hashToken(token)).execute();
}
