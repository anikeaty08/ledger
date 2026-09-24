import { zeroAddress } from "viem";
import { publicClient, getWalletClient } from "../client.js";
import { ledgerAccountFactoryAbi, ledgerAccountAbi } from "../abi.js";
import { requireEnv } from "../env.js";

/**
 * Discovers LedgerAccounts (via AccountCreated events) and, for any with the guardian enabled and an
 * unhealthy ICR, calls the permissionless `guardianCheck`. The guardian can only reduce risk (repay or
 * add collateral) within the owner's own pre-signed daily limits — this job never moves funds it
 * doesn't already have on-chain authorization to move. It also opportunistically calls `paydown` on
 * every active account so reserved income keeps compounding into debt reduction.
 */
export async function runGuardianSweep(): Promise<{ checked: number; acted: number; errors: number }> {
  const factoryAddr = requireEnv("ledgerAccountFactory");
  const { wallet } = getWalletClient();

  const logs = await publicClient.getContractEvents({
    address: factoryAddr,
    abi: ledgerAccountFactoryAbi,
    eventName: "AccountCreated",
    fromBlock: "earliest",
    toBlock: "latest",
  });

  let checked = 0;
  let acted = 0;
  let errors = 0;

  for (const log of logs) {
    const account = log.args.account as `0x${string}` | undefined;
    if (!account) continue;
    checked++;

    try {
      const [, , icr, active] = await publicClient.readContract({
        address: account,
        abi: ledgerAccountAbi,
        functionName: "position",
      });
      if (!active) continue;

      const guardian = await publicClient.readContract({
        address: account,
        abi: ledgerAccountAbi,
        functionName: "guardian",
      });
      const [enabled, , actionICRBps] = guardian;

      if (enabled && icr < BigInt(actionICRBps) * 10n ** 14n) {
        try {
          const hash = await wallet.writeContract({
            address: account,
            abi: ledgerAccountAbi,
            functionName: "guardianCheck",
            args: [zeroAddress, zeroAddress],
            chain: wallet.chain,
          });
          console.log(`[keeper] guardianCheck(${account}) -> ${hash}`);
          acted++;
        } catch (err) {
          // NothingToDo() is expected when another keeper beat us to it this block — not an error.
          if (!String(err).includes("NothingToDo")) throw err;
        }
      }

      try {
        const hash = await wallet.writeContract({
          address: account,
          abi: ledgerAccountAbi,
          functionName: "paydown",
          args: [zeroAddress, zeroAddress],
          chain: wallet.chain,
        });
        console.log(`[keeper] paydown(${account}) -> ${hash}`);
      } catch (err) {
        if (!String(err).includes("NothingToDo")) throw err;
      }
    } catch (err) {
      console.warn(`[keeper] skip account ${account}:`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  return { checked, acted, errors };
}
