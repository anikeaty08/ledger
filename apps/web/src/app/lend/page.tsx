"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { LedgerSheet, LedgerSheetHeader, LedgerRow, Button, Input, Label } from "@/components/Ledger";
import { Amount } from "@/components/Amount";
import { requireAddress, addresses } from "@/lib/addresses";
import { trancheVaultAbi } from "@/lib/abis/shared";
import { formatUnits18, parseUnits18 } from "@/lib/format";
import type { Address } from "viem";

function TrancheCard({
  name,
  description,
  vault,
}: {
  name: string;
  description: string;
  vault: Address;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: totalAssets } = useReadContract({ address: vault, abi: trancheVaultAbi, functionName: "totalAssets" });
  const { data: utilizationBps } = useReadContract({ address: vault, abi: trancheVaultAbi, functionName: "utilizationBps" });
  const { data: cooldown } = useReadContract({ address: vault, abi: trancheVaultAbi, functionName: "cooldown" });
  const { data: shareBalance, refetch: refetchBalance } = useReadContract({
    address: vault,
    abi: trancheVaultAbi,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address },
  });

  async function handleDeposit() {
    if (!address) return;
    const assets = parseUnits18(amount);
    if (assets === 0n) return;
    setWorking(true);
    setError(null);
    try {
      const musd = requireAddress("musd");
      const allowance = await publicClient!.readContract({
        address: musd,
        abi: trancheVaultAbi,
        functionName: "allowance",
        args: [address, vault],
      });
      if (allowance < assets) {
        const approveHash = await writeContractAsync({
          address: musd,
          abi: trancheVaultAbi,
          functionName: "approve",
          args: [vault, assets],
        });
        await publicClient!.waitForTransactionReceipt({ hash: approveHash });
      }
      const hash = await writeContractAsync({
        address: vault,
        abi: trancheVaultAbi,
        functionName: "deposit",
        args: [assets, address],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      await refetchBalance();
      setAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <LedgerSheet>
      <LedgerSheetHeader>
        <span className="text-[15px] text-ink">{name}</span>
      </LedgerSheetHeader>
      <div className="p-5">
        <p className="mb-4 text-sm text-ink-soft">{description}</p>
        <LedgerRow label="Total deposited">
          <Amount value={totalAssets ?? 0n} currency="MUSD" />
        </LedgerRow>
        <LedgerRow label="Utilization">{utilizationBps !== undefined ? `${Number(utilizationBps) / 100}%` : "—"}</LedgerRow>
        <LedgerRow label="Your shares" last>
          <Amount value={shareBalance ?? 0n} currency="MUSD" />
        </LedgerRow>

        {cooldown !== undefined && cooldown > 0n && (
          <p className="mt-3 text-xs text-ink-soft">
            Withdrawals need a {Number(cooldown) / 86400}-day notice on this tranche.
          </p>
        )}

        <div className="mt-4">
          <Label>Deposit MUSD</Label>
          <div className="flex gap-2">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,000.00" inputMode="decimal" />
            <Button variant="primary" onClick={handleDeposit} disabled={working || !address}>
              {working ? "…" : "Deposit"}
            </Button>
          </div>
        </div>
        {error && <p className="mt-3 border border-red/30 bg-red-soft px-3 py-2 text-xs text-red">{error}</p>}
      </div>
    </LedgerSheet>
  );
}

export default function LendPage() {
  if (!addresses.seniorVault || !addresses.juniorVault) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-ink-soft">Vaults aren&apos;t deployed yet.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">Lend</h1>
      <p className="mt-2 text-ink-soft">
        Fund invoice advances and earn yield from real invoices, not DeFi loops.
      </p>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <TrancheCard
          name="Senior (lsMUSD)"
          description="Repaid first on every advance. Second loss. Instant withdrawals up to idle liquidity."
          vault={addresses.seniorVault}
        />
        <TrancheCard
          name="Junior (ljMUSD)"
          description="Higher yield, first loss if a client defaults. 7-day withdrawal notice."
          vault={addresses.juniorVault}
        />
      </div>
    </div>
  );
}
