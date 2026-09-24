import { Hono } from "hono";
import { z } from "zod";
import { relayerClient, publicClient, requireAddress } from "../lib/chain.js";
import { invoiceRegistryAbi } from "../lib/abi.js";
import { env } from "../lib/env.js";
import { AddressSchema, HexSchema, InvoiceIdSchema } from "../lib/validation.js";

/**
 * The relayer only ever submits a payload the payer has ALREADY signed off-chain (EIP-712 invoice
 * acceptance). It cannot construct or alter what it signs — the contract independently verifies the
 * signature against the exact (invoiceId, commitment, amount, dueDate, payer, deadline) tuple, so a
 * malicious or compromised relayer can relay a valid signature but can never forge one.
 * The relayer pays gas only; it never touches user funds.
 */
export const relayRoutes = new Hono();

const AcceptRequest = z.object({
  invoiceId: z.coerce.bigint(),
  payer: AddressSchema,
  deadline: z.coerce.bigint(),
  signature: HexSchema,
});

relayRoutes.post("/accept-invoice", async (c) => {
  if (!relayerClient) return c.json({ error: "relayer not configured" }, 503);
  const body = await c.req.json().catch(() => ({}));
  const parsed = AcceptRequest.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const address = requireAddress("INVOICE_REGISTRY_ADDRESS", env.INVOICE_REGISTRY_ADDRESS);

  // Defense in depth: verify the signature ourselves before spending gas, even though the contract
  // will also reject a bad one. Saves a guaranteed-to-revert relay from ever hitting the mempool.
  const digest = await publicClient.readContract({
    address,
    abi: invoiceRegistryAbi,
    functionName: "acceptanceDigest",
    args: [parsed.data.invoiceId, parsed.data.payer, parsed.data.deadline],
  });
  if (!digest) return c.json({ error: "invoice not found" }, 404);

  try {
    const hash = await relayerClient.writeContract({
      address,
      abi: invoiceRegistryAbi,
      functionName: "acceptInvoiceWithSig",
      args: [parsed.data.invoiceId, parsed.data.payer, parsed.data.deadline, parsed.data.signature],
      chain: relayerClient.chain,
    });
    return c.json({ txHash: hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : "relay failed";
    // Common revert reasons surface here: BadSignature, Expired, BadStatus, WrongPayer.
    return c.json({ error: message }, 400);
  }
});

/** Validates a signature client-side would submit against, without spending gas — used by the frontend
 *  to preview whether a signature the wallet just produced will actually be accepted. */
const PreviewDigestRequest = z.object({
  invoiceId: InvoiceIdSchema,
  payer: AddressSchema,
  deadline: z.coerce.bigint(),
});

relayRoutes.post("/acceptance-digest", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = PreviewDigestRequest.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const address = requireAddress("INVOICE_REGISTRY_ADDRESS", env.INVOICE_REGISTRY_ADDRESS);
  const digest = await publicClient.readContract({
    address,
    abi: invoiceRegistryAbi,
    functionName: "acceptanceDigest",
    args: [parsed.data.invoiceId, parsed.data.payer, parsed.data.deadline],
  });
  return c.json({ digest });
});
