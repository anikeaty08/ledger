"use client";

import { use } from "react";
import { useReadContract } from "wagmi";
import { isAddress } from "viem";
import { LedgerSheet, LedgerSheetHeader, LedgerRow } from "@/components/Ledger";
import { NotDeployed } from "@/components/NotDeployed";
import { addresses } from "@/lib/addresses";
import { reputationRegistryAbi } from "@/lib/abis/shared";
import { shortAddress } from "@/lib/format";

function tierFor(score: number): { label: string; color: string } {
  if (score >= 800) return { label: "Gold", color: "text-gold" };
  if (score >= 500) return { label: "Silver", color: "text-ink" };
  if (score >= 1) return { label: "Bronze", color: "text-ink-soft" };
  return { label: "New", color: "text-ink-soft" };
}

export default function ReputationPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const valid = isAddress(address);

  const deployed = !!addresses.reputationRegistry;

  const { data: score } = useReadContract({
    address: addresses.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "clientScore",
    args: [address as `0x${string}`],
    query: { enabled: valid && deployed },
  });

  const { data: stats } = useReadContract({
    address: addresses.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "payers",
    args: [address as `0x${string}`],
    query: { enabled: valid && deployed },
  });

  if (!valid) {
    return <div className="mx-auto max-w-xl px-6 py-16 text-red">Not a valid address.</div>;
  }

  if (!deployed) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <NotDeployed what="Payment records" />
      </div>
    );
  }

  const tier = tierFor(Number(score ?? 0n));
  const onTimeRate = stats && stats[0] > 0 ? Math.round((Number(stats[1]) / Number(stats[0])) * 100) : null;

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">Payment record</h1>
      <p className="mt-2 text-ink-soft">{shortAddress(address)}</p>

      <LedgerSheet className="mt-6">
        <LedgerSheetHeader>
          <span className={`text-[15px] font-medium ${tier.color}`}>{tier.label} payer</span>
        </LedgerSheetHeader>
        <LedgerRow label="Score">{score?.toString() ?? "0"} / 1000</LedgerRow>
        <LedgerRow label="Invoices settled">{stats?.[0]?.toString() ?? "0"}</LedgerRow>
        <LedgerRow label="On-time rate">{onTimeRate !== null ? `${onTimeRate}%` : "—"}</LedgerRow>
        <LedgerRow label="Distinct issuers paid" last>
          {stats?.[4]?.toString() ?? "0"}
        </LedgerRow>
      </LedgerSheet>

      <p className="mt-6 text-sm text-ink-soft">
        This record is public and on-chain — anyone can verify it before advancing you an invoice.
      </p>
    </div>
  );
}
