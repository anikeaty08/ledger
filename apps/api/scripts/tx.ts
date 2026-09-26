/**
 * Transaction helpers shared by the smoke/payment/advance scripts. Mirrors apps/web/src/lib/tx.ts so the
 * scripts exercise the same gas and receipt handling the app uses on Mezo testnet.
 */
import type { Hash, PublicClient, WalletClient } from "viem";

// Some Mezo RPC nodes answer eth_estimateGas with only the intrinsic cost (~21.6k-23.2k) instead of
// simulating the call; no contract write here costs under 30k, so a lower estimate is treated as bogus.
const BOGUS_ESTIMATE = 30_000n;
const FALLBACK_GAS = 1_500_000n;

export async function waitForReceipt(pub: PublicClient, hash: Hash, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await pub.getTransactionReceipt({ hash });
    } catch (err) {
      if (!(err instanceof Error) || err.name !== "TransactionReceiptNotFoundError" || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

export async function withGas<T extends object>(pub: PublicClient, account: WalletClient["account"], req: T): Promise<T & { gas: bigint }> {
  let lastError: unknown;
  let sawBogus = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const estimate = await pub.estimateContractGas({ ...req, account } as never);
      if (estimate >= BOGUS_ESTIMATE) return { ...req, gas: (estimate * 3n) / 2n + 50_000n };
      sawBogus = true;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  if (sawBogus) return { ...req, gas: FALLBACK_GAS };
  throw lastError;
}

/** writeContract with a safe gas limit, then wait for the receipt; throws if it reverted on-chain. */
export async function sendTx(pub: PublicClient, wallet: WalletClient, req: object) {
  const withLimit = await withGas(pub, wallet.account, req);
  const hash = await wallet.writeContract(withLimit as never);
  const receipt = await waitForReceipt(pub, hash);
  if (receipt.status !== "success") {
    throw new Error(`${(req as { functionName?: string }).functionName} reverted on-chain: used ${receipt.gasUsed} of ${withLimit.gas} (tx ${hash})`);
  }
  return receipt;
}
