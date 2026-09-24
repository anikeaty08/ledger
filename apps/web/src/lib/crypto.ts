import { keccak256, toHex } from "viem";

/**
 * Invoice terms are encrypted here, in the browser, before anything reaches the API. The decryption
 * key never leaves the browser except inside the pay-link's URL fragment (`#k=...`), which browsers
 * never send to a server. See apps/api/src/lib/blobs.ts and docs/SYSTEM_DESIGN.md §15 "Privacy".
 */

export interface EncryptedTerms {
  ciphertextB64: string;
  ivB64: string;
  keyB64Url: string; // goes in the URL fragment, never sent to the API
  commitment: `0x${string}`; // keccak256(ciphertext), matches the on-chain commitment
}

export interface InvoiceTerms {
  description: string;
  clientName?: string;
  clientEmail?: string;
  lineItems?: { label: string; amount: string }[];
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// Typed as Uint8Array<ArrayBuffer> explicitly: the DOM lib's BufferSource type only accepts that
// exact generic (never <ArrayBufferLike>, which could be a SharedArrayBuffer), and TS otherwise infers
// the wider type from `new Uint8Array(length)` in some lib.dom.d.ts versions. This is a real,
// always-true guarantee here — decoded base64 is never backed by a SharedArrayBuffer — not a cast
// papering over an actual risk.
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptTerms(terms: InvoiceTerms): Promise<EncryptedTerms> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(terms));

  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", key));

  const ciphertextB64 = toBase64(ciphertext);
  const commitment = keccak256(toHex(ciphertext));

  return {
    ciphertextB64,
    ivB64: toBase64(iv),
    keyB64Url: toBase64(rawKey).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    commitment,
  };
}

export async function decryptTerms(
  ciphertextB64: string,
  ivB64: string,
  keyB64Url: string,
): Promise<InvoiceTerms> {
  const rawKey = fromBase64(keyB64Url.replace(/-/g, "+").replace(/_/g, "/"));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = fromBase64(ivB64);
  const ciphertext = fromBase64(ciphertextB64);

  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as InvoiceTerms;
}

/** The salt-less commitment used above (keccak256(ciphertext)) must match
 *  apps/api/src/lib/blobs.ts#commitmentOf exactly — verified by a shared fixture in both test suites. */
export function commitmentOf(ciphertextB64: string): `0x${string}` {
  return keccak256(toHex(fromBase64(ciphertextB64)));
}
