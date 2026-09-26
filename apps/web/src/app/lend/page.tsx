"use client";

import { useState } from "react";
import { waitForReceipt, withGas } from "@/lib/tx";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { LedgerSheet, LedgerSheetHeader, LedgerRow, Button, Input, Label, Notice } from "@/components/Ledger";
import { NotDeployed } from "@/components/NotDeployed";
import { Amount } from "@/components/Amount";
import { requireAddress, addresses } from "@/lib/addresses";
import { trancheVaultAbi } from "@/lib/abis/shared";
import { formatBps, formatUnits18, parseUnits18 } from "@/lib/format";
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
        const approveHash = await writeContractAsync(
          await withGas(publicClient!, address, {
            address: musd,
            abi: trancheVaultAbi,
            functionName: "approve",
            args: [vault, assets],
          }),
        );
        await waitForReceipt(publicClient!, approveHash);
      }
      const hash = await writeContractAsync(
        await withGas(publicClient!, address, {
          address: vault,
          abi: trancheVaultAbi,
          functionName: "deposit",
          args: [assets, address],
        }),
      );
      await waitForReceipt(publicClient!, hash);
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
      <p className="border-b border-rule-soft px-5 py-4 text-sm text-ink-soft">{description}</p>
      <LedgerRow label="Total deposited">
          <Amount value={totalAssets ?? 0n} currency="MUSD" />
        </LedgerRow>
        <LedgerRow label="Lent out now">
          <span className="tabular font-mono text-ink">
            {utilizationBps !== undefined ? formatBps(Number(utilizationBps)) : "—"}
          </span>
        </LedgerRow>
        <LedgerRow label="Your shares" last>
          <span className="tabular font-mono text-ink">{formatUnits18(shareBalance ?? 0n)}</span>
        </LedgerRow>

      <div className="border-t border-rule px-5 pb-5 pt-4">
        {cooldown !== undefined && cooldown > 0n && (
          <p className="mb-4 text-[13px] text-ink-soft">
            Withdrawals need a {Number(cooldown) / 86400}-day notice on this tranche.
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleDeposit();
          }}
        >
          <Label htmlFor={`deposit-${vault}`}>Deposit MUSD</Label>
          <div className="flex gap-2">
            <Input
              id={`deposit-${vault}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
              placeholder="1,000.00"
              inputMode="decimal"
              disabled={!address}
            />
            <Button type="submit" variant="primary" disabled={working || !address || !amount} className="shrink-0">
              {working ? "Depositing…" : "Deposit"}
            </Button>
          </div>
          {!address && <p className="mt-2 text-[13px] text-ink-soft">Connect a wallet to deposit.</p>}
        </form>
        {error && (
          <Notice className="mt-3">{`${error} Check your wallet's activity before trying again, in case the deposit went through.`}</Notice>
        )}
      </div>
    </LedgerSheet>
  );
}

export default function LendPage() {
  if (!addresses.seniorVault || !addresses.juniorVault) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="mb-6 text-2xl font-semibold text-ink">Lend</h1>
        <NotDeployed what="Lending pools" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-ink">Lend</h1>
      <p className="mt-2 text-ink-soft">
        Your MUSD funds advances on client-accepted invoices. Pick how much default risk you take.
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
