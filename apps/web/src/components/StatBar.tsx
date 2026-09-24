"use client";

import { useReadContract } from "wagmi";
import { addresses } from "@/lib/addresses";
import { trancheVaultAbi } from "@/lib/abis/shared";
import { formatUnits18 } from "@/lib/format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-rule px-8 py-6 last:border-r-0">
      <div className="tabular font-mono text-2xl text-ink">{value}</div>
      <div className="mt-1 text-sm text-ink-soft">{label}</div>
    </div>
  );
}

/** Reads live from the deployed vaults. Before deployment, shows the mechanism instead of a fake
 *  number — never a placeholder metric dressed up as real data. */
export function StatBar() {
  const deployed = !!addresses.seniorVault && !!addresses.juniorVault;

  const { data: seniorAssets } = useReadContract({
    address: addresses.seniorVault,
    abi: trancheVaultAbi,
    functionName: "totalAssets",
    query: { enabled: deployed },
  });
  const { data: juniorAssets } = useReadContract({
    address: addresses.juniorVault,
    abi: trancheVaultAbi,
    functionName: "totalAssets",
    query: { enabled: deployed },
  });

  if (!deployed) {
    return (
      <div className="border border-rule bg-paper px-8 py-6 text-sm text-ink-soft">
        Advances are funded by a public lender pool, split into a senior tranche repaid first and a
        junior tranche that earns more for taking first loss.
      </div>
    );
  }

  const total = (seniorAssets ?? 0n) + (juniorAssets ?? 0n);

  return (
    <div className="grid grid-cols-1 border border-rule bg-paper sm:grid-cols-3">
      <Stat label="Available to lend" value={`${formatUnits18(total, 0)} MUSD`} />
      <Stat label="Senior tranche" value={`${formatUnits18(seniorAssets ?? 0n, 0)} MUSD`} />
      <Stat label="Junior tranche" value={`${formatUnits18(juniorAssets ?? 0n, 0)} MUSD`} />
    </div>
  );
}
