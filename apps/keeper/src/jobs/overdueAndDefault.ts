import { publicClient, getWalletClient } from "../client.js";
import { invoiceRegistryAbi, collectionsManagerAbi } from "../abi.js";
import { env, requireEnv } from "../env.js";

/**
 * InvoiceStatus enum ordinals (mirrors src/libraries/Types.sol):
 * 0 None, 1 Issued, 2 Accepted, 3 Financed, 4 PartiallyPaid, 5 Overdue, 6 Disputed, 7 Settled,
 * 8 Defaulted, 9 Cancelled.
 */
const ACTIONABLE_FOR_OVERDUE = new Set([2, 3, 4]); // Accepted, Financed, PartiallyPaid
const ACTIONABLE_FOR_DEFAULT = new Set([2, 3, 4, 5]); // + Overdue

/**
 * Sweeps recent invoice ids and, for any that are past their due date / grace period, calls the
 * permissionless `markOverdue` / `declareDefault` functions. Every invoice touched here was already
 * eligible on-chain — this job just pays the gas to flip state that anyone could flip. Errors on one
 * invoice never abort the sweep for the rest.
 */
export async function runOverdueAndDefaultSweep(): Promise<{ overdued: number; defaulted: number; errors: number }> {
  const registryAddr = requireEnv("invoiceRegistry");
  const collectionsAddr = requireEnv("collectionsManager");
  const { wallet } = getWalletClient();

  const nextId = await publicClient.readContract({
    address: registryAddr,
    abi: invoiceRegistryAbi,
    functionName: "nextId",
  });

  const total = Number(nextId) - 1;
  const start = Math.max(1, total - env.batchSize + 1);
  let overdued = 0;
  let defaulted = 0;
  let errors = 0;

  for (let id = start; id <= total; id++) {
    const invoiceId = BigInt(id);
    try {
      const invoice = await publicClient.readContract({
        address: registryAddr,
        abi: invoiceRegistryAbi,
        functionName: "getInvoice",
        args: [invoiceId],
      });

      const status = invoice.status;
      const now = BigInt(Math.floor(Date.now() / 1000));

      if (ACTIONABLE_FOR_DEFAULT.has(status)) {
        const defaultableAt = await publicClient.readContract({
          address: collectionsAddr,
          abi: collectionsManagerAbi,
          functionName: "defaultableAt",
          args: [invoiceId],
        });
        if (now > defaultableAt) {
          const hash = await wallet.writeContract({
            address: collectionsAddr,
            abi: collectionsManagerAbi,
            functionName: "declareDefault",
            args: [invoiceId],
            chain: wallet.chain,
          });
          console.log(`[keeper] declareDefault(${id}) -> ${hash}`);
          defaulted++;
          continue;
        }
      }

      if (ACTIONABLE_FOR_OVERDUE.has(status) && now > invoice.dueDate) {
        const hash = await wallet.writeContract({
          address: registryAddr,
          abi: invoiceRegistryAbi,
          functionName: "markOverdue",
          args: [invoiceId],
          chain: wallet.chain,
        });
        console.log(`[keeper] markOverdue(${id}) -> ${hash}`);
        overdued++;
      }
    } catch (err) {
      // A single stale/raced invoice (e.g. paid between the read and the write) must not kill the sweep.
      console.warn(`[keeper] skip invoice ${id}:`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  return { overdued, defaulted, errors };
}
