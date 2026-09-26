import type { Address, Hash, PublicClient, TransactionReceipt } from "viem";

/** Mezo's load-balanced RPC can answer "receipt not found" for a transaction another node has already
 *  mined, and viem's waitForTransactionReceipt gives up on that. Poll the receipt directly instead, so a
 *  successful transaction is never reported to the user as a failure. */
export async function waitForReceipt(client: PublicClient, hash: Hash, timeoutMs = 180_000): Promise<TransactionReceipt> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash });
    } catch (err) {
      if (!(err instanceof Error) || err.name !== "TransactionReceiptNotFoundError") throw err;
      if (Date.now() > deadline) throw new Error("The network hasn't confirmed this transaction yet. Check your wallet's activity before trying again.");
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

// Some Mezo RPC nodes answer eth_estimateGas with only the intrinsic cost (~21,600-23,200) instead of
// simulating the call: measured 21,852 for a requestAdvance that uses 541,979. No contract write in this
// app costs under 30k, so a lower estimate is treated as bogus.
const BOGUS_ESTIMATE = 30_000n;
// Used when every estimate is bogus: ~3x the heaviest measured call (requestAdvance). Only gas actually
// used is charged, so the headroom costs nothing.
const FALLBACK_GAS = 1_500_000n;

/**
 * Adds an explicit gas limit to a contract write, because wallets pass Mezo's estimate straight through
 * and an under-estimate makes the transaction run out of gas (or be rejected under the EIP-7623 floor).
 * Retries the estimate so a lagging node that hasn't seen a just-confirmed approval doesn't fail the flow.
 */
export async function withGas<const T extends { address: Address }>(client: PublicClient, account: Address, params: T): Promise<T & { gas: bigint }> {
  let lastError: unknown;
  let sawBogus = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const estimate = await client.estimateContractGas({ ...params, account } as never);
      if (estimate >= BOGUS_ESTIMATE) return { ...params, gas: (estimate * 3n) / 2n + 50_000n };
      sawBogus = true;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  if (sawBogus) return { ...params, gas: FALLBACK_GAS };
  throw lastError;
}
