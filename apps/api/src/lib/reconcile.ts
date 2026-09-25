import { zeroAddress, type Address } from "viem";
import { db } from "../db/pool.js";
import { env } from "./env.js";
import { publicClient, requireAddress } from "./chain.js";
import { invoiceRegistryAbi } from "./abi.js";

const FINANCED = 3;

export type OnChainInvoice = Awaited<ReturnType<typeof readInvoice>>;

export async function readInvoice(invoiceId: bigint) {
  return publicClient.readContract({
    address: requireAddress("INVOICE_REGISTRY_ADDRESS", env.INVOICE_REGISTRY_ADDRESS),
    abi: invoiceRegistryAbi,
    functionName: "getInvoice",
    args: [invoiceId],
  });
}

/** Re-reads one invoice from the chain and upserts invoice_cache. Returns null if it doesn't exist. */
export async function reconcileInvoice(invoiceId: bigint, txHash?: string, known?: OnChainInvoice) {
  const inv = known ?? (await readInvoice(invoiceId));
  if (inv.issuer === zeroAddress) return null;

  const row = {
    invoice_id: invoiceId.toString(),
    issuer: inv.issuer.toLowerCase(),
    payer: inv.payer === zeroAddress ? null : inv.payer.toLowerCase(),
    amount: inv.amount.toString(),
    paid: inv.paid.toString(),
    due_date: new Date(Number(inv.dueDate) * 1000),
    status: inv.status,
    financed: inv.status === FINANCED,
    tx_hash: txHash ?? null,
    updated_at: new Date(),
  };
  await db
    .insertInto("invoice_cache")
    .values(row)
    .onConflict((oc) =>
      oc.column("invoice_id").doUpdateSet({
        payer: row.payer,
        amount: row.amount,
        paid: row.paid,
        due_date: row.due_date,
        status: row.status,
        financed: row.financed,
        tx_hash: (eb) => eb.fn.coalesce(eb.val(row.tx_hash), eb.ref("invoice_cache.tx_hash")),
        updated_at: row.updated_at,
      }),
    )
    .execute();
  return row;
}

export function isIssuer(inv: OnChainInvoice, address: Address): boolean {
  return inv.issuer.toLowerCase() === address.toLowerCase();
}
