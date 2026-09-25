import { Hono } from "hono";
import { z } from "zod";
import { BaseError, ContractFunctionRevertedError, zeroAddress } from "viem";
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
  const args = [parsed.data.invoiceId, parsed.data.payer, parsed.data.deadline, parsed.data.signature] as const;

  const invoice = await publicClient.readContract({
    address,
    abi: invoiceRegistryAbi,
    functionName: "getInvoice",
    args: [parsed.data.invoiceId],
  });
  if (invoice.issuer === zeroAddress) return c.json({ error: "invoice not found" }, 404);

  try {
    // Simulate first so a doomed relay (BadSignature, Expired, BadStatus, WrongPayer) never costs gas and
    // comes back as the contract's own reason.
    const { request } = await publicClient.simulateContract({
      account: relayerClient.account,
      address,
      abi: invoiceRegistryAbi,
      functionName: "acceptInvoiceWithSig",
      args,
    });
    // Mezo testnet's eth_estimateGas under-reports this call (23,180 estimated vs 123,123 used), so the
    // limit is set explicitly with headroom instead of trusting the estimate.
    const estimate = await publicClient.estimateContractGas({ ...request, account: relayerClient.account });
    const gas = estimate * 3n / 2n > RELAY_GAS_FLOOR ? (estimate * 3n) / 2n : RELAY_GAS_FLOOR;
    const hash = await relayerClient.writeContract({ ...request, gas });
    return c.json({ txHash: hash });
  } catch (err) {
    const revert =
      err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : undefined;
    if (revert instanceof ContractFunctionRevertedError) {
      return c.json({ error: revert.data?.errorName ?? "reverted" }, 400);
    }
    console.error("[relay] accept-invoice failed", err);
    return c.json({ error: "relay failed, try again" }, 502);
  }
});

const RELAY_GAS_FLOOR = 200_000n;

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
