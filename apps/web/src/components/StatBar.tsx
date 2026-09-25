"use client";

import { useReadContract } from "wagmi";
import { addresses } from "@/lib/addresses";
import { trancheVaultAbi } from "@/lib/abis/shared";
import { useCountUp } from "@/lib/useCountUp";

function Stat({ label, valueWei }: { label: string; valueWei: bigint }) {
  // Whole MUSD units: safe as a JS number at any realistic vault size, and only used for display.
  const wholeUnits = Number(valueWei / 10n ** 18n);
  const { ref, value } = useCountUp(wholeUnits);

  return (
    <div className="px-6 py-5">
      <div className="text-[13px] text-ink-soft">{label}</div>
      <div className="tabular mt-1.5 font-mono text-[26px] tracking-[-0.02em] text-ink">
        <span ref={ref}>{value.toLocaleString("en-US")}</span>
        <span className="ml-1.5 font-sans text-[13px] text-ink-faint">MUSD</span>
      </div>
    </div>
  );
}

/** Reads live from the deployed vaults. Before deployment, explains the mechanism instead of showing a
 *  made-up number. */
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
      <div className="panel rounded-lg border border-rule px-6 py-5 text-[14px] text-ink-soft">
        Advances are funded by a public lender pool, split into a senior tranche repaid first and a junior tranche
        that earns more for taking first loss.
      </div>
    );
  }

  const total = (seniorAssets ?? 0n) + (juniorAssets ?? 0n);

  return (
    <div className="panel grid grid-cols-1 divide-y divide-rule rounded-lg border border-rule sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <Stat label="Total in lender pools" valueWei={total} />
      <Stat label="Senior tranche" valueWei={seniorAssets ?? 0n} />
      <Stat label="Junior tranche" valueWei={juniorAssets ?? 0n} />
    </div>
  );
}
