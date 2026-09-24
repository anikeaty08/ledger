import { keccak256, type Address } from "viem";
import { db } from "../db/pool.js";

/**
 * Invoice terms (line items, names, emails — anything sensitive) never reach this server in plaintext
 * and the decryption key never reaches it at all: the frontend encrypts client-side (AES-GCM) and the
 * key travels only in the pay-link URL fragment (`#k=...`), which browsers never send in requests.
 *
 * This module stores ciphertext and checks it against the on-chain commitment so a stored blob can be
 * proven to match what was actually put on-chain (tamper-evidence, not secrecy — secrecy comes from
 * the key never being sent here at all).
 */

export interface StoreBlobInput {
  invoiceId: bigint;
  issuer: Address;
  payerHint?: string;
  ciphertextB64: string;
  ivB64: string;
  /** 0x-hex commitment as computed client-side: keccak256(ciphertext || salt). */
  commitment: `0x${string}`;
}

export class CommitmentMismatchError extends Error {
  constructor() {
    super("commitment does not match keccak256(ciphertext)");
  }
}

/** Recomputes the commitment from the stored ciphertext bytes and checks it matches what was claimed.
 *  Note: this checks internal consistency of what the client sent; matching the *on-chain* commitment
 *  is verified separately by the caller against an indexed InvoiceCreated event before trusting a blob. */
function verifyInternalCommitment(ciphertextB64: string, commitment: `0x${string}`): boolean {
  const bytes = Buffer.from(ciphertextB64, "base64");
  const digest = keccak256(bytes);
  return digest.toLowerCase() === commitment.toLowerCase();
}

export async function storeInvoiceBlob(input: StoreBlobInput): Promise<void> {
  if (!verifyInternalCommitment(input.ciphertextB64, input.commitment)) {
    throw new CommitmentMismatchError();
  }
  await db
    .insertInto("invoice_blobs")
    .values({
      invoice_id: input.invoiceId.toString(),
      issuer: input.issuer.toLowerCase(),
      payer_hint: input.payerHint ?? null,
      ciphertext: input.ciphertextB64,
      iv: input.ivB64,
      commitment: input.commitment.toLowerCase(),
      created_at: new Date(),
    })
    .onConflict((oc) =>
      oc.column("invoice_id").doUpdateSet({
        ciphertext: (eb) => eb.ref("excluded.ciphertext"),
        iv: (eb) => eb.ref("excluded.iv"),
        commitment: (eb) => eb.ref("excluded.commitment"),
      }),
    )
    .execute();
}

export async function getInvoiceBlob(invoiceId: bigint) {
  return db
    .selectFrom("invoice_blobs")
    .selectAll()
    .where("invoice_id", "=", invoiceId.toString())
    .executeTakeFirst();
}

/** Cross-checks a stored blob's commitment against the authoritative on-chain value. */
export function matchesOnChainCommitment(blobCommitment: string, onChainCommitment: `0x${string}`): boolean {
  return blobCommitment.toLowerCase() === onChainCommitment.toLowerCase();
}

export function commitmentOf(ciphertextB64: string): `0x${string}` {
  return keccak256(Buffer.from(ciphertextB64, "base64"));
}
