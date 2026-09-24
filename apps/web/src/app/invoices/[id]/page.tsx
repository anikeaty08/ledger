"use client";

import { use, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { LedgerSheet, LedgerSheetHeader, LedgerRow, Button, Input, Label } from "@/components/Ledger";
import { Amount } from "@/components/Amount";
import { StatusBadge } from "@/components/StatusBadge";
import { NotDeployed } from "@/components/NotDeployed";
import { addresses, requireAddress } from "@/lib/addresses";
import { invoiceRegistryAbi } from "@/lib/abis/invoiceRegistry";
import { advanceEngineAbi } from "@/lib/abis/advanceEngine";
import { erc20Abi } from "@/lib/abis/shared";
import { receivableNFTApproveAbi } from "@/lib/abis/receivable";
import { formatBps, formatDate, formatUnits18, parseUnits18, InvoiceStatus } from "@/lib/format";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const invoiceId = BigInt(id);
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [advanceAmount, setAdvanceAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);

  const deployed = !!addresses.invoiceRegistry && !!addresses.advanceEngine;

  const { data: invoice } = useReadContract({
    address: addresses.invoiceRegistry,
    abi: invoiceRegistryAbi,
    functionName: "getInvoice",
    args: [invoiceId],
    query: { enabled: deployed },
  });

  const { data: quote, refetch: refetchQuote } = useReadContract({
    address: addresses.advanceEngine,
    abi: advanceEngineAbi,
    functionName: "quote",
    args: [invoiceId],
    query: { enabled: deployed },
  });

  const { data: existingAdvance } = useReadContract({
    address: addresses.advanceEngine,
    abi: advanceEngineAbi,
    functionName: "getAdvance",
    args: [invoiceId],
    query: { enabled: deployed },
  });

  if (!deployed) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <NotDeployed what="Invoices" />
      </div>
    );
  }

  if (!invoice) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-ink-soft">Loading invoice…</div>;
  }

  const isOwner = address?.toLowerCase() === invoice.issuer.toLowerCase();
  const canAdvance = isOwner && invoice.status === InvoiceStatus.Accepted && quote?.eligible;
  const requested = advanceAmount ? parseUnits18(advanceAmount) : 0n;
  const projectedFee =
    requested > 0n && quote
      ? (requested * BigInt(quote.feePer30dBps) * BigInt(Math.ceil(Number(quote.tenorDays) / 30) || 1)) / 10_000n
      : 0n;

  async function handleAdvance() {
    if (!quote) return;
    setStatus("working");
    setError(null);
    try {
      const recourse = requested > 0n ? (requested * BigInt(quote.recourseBps)) / 10_000n + 1n : 0n;
      const maxFee = projectedFee + projectedFee / 10n + 1n; // small slippage buffer on the fee cap

      if (recourse > 0n) {
        const musd = requireAddress("musd");
        const allowance = await publicClient!.readContract({
          address: musd,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address!, requireAddress("advanceEngine")],
        });
        if (allowance < recourse) {
          const approveHash = await writeContractAsync({
            address: musd,
            abi: erc20Abi,
            functionName: "approve",
            args: [requireAddress("advanceEngine"), recourse],
          });
          await publicClient!.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      const nftAddress = await publicClient!.readContract({
        address: requireAddress("invoiceRegistry"),
        abi: invoiceRegistryAbi,
        functionName: "receivableNFT",
      });
      const approveNftHash = await writeContractAsync({
        address: nftAddress,
        abi: receivableNFTApproveAbi,
        functionName: "approve",
        args: [requireAddress("advanceEngine"), invoiceId],
      });
      await publicClient!.waitForTransactionReceipt({ hash: approveNftHash });

      const hash = await writeContractAsync({
        address: requireAddress("advanceEngine"),
        abi: advanceEngineAbi,
        functionName: "requestAdvance",
        args: [invoiceId, requested, maxFee, recourse],
      });
      await publicClient!.waitForTransactionReceipt({ hash });
      await refetchQuote();
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Advance failed.");
      setStatus("idle");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Invoice #{id}</h1>
        <StatusBadge status={invoice.status as InvoiceStatus} />
      </div>

      <LedgerSheet>
        <LedgerRow label="Amount">
          <Amount value={invoice.amount} currency="MUSD" size="lg" />
        </LedgerRow>
        <LedgerRow label="Paid so far">
          <Amount value={invoice.paid} currency="MUSD" />
        </LedgerRow>
        <LedgerRow label="Due" last>
          {formatDate(invoice.dueDate)}
        </LedgerRow>
      </LedgerSheet>

      {existingAdvance?.active && (
        <LedgerSheet className="mt-6">
          <LedgerSheetHeader>
            <span className="text-[15px] text-ink">Active advance</span>
          </LedgerSheetHeader>
          <LedgerRow label="Advanced">
            <Amount value={existingAdvance.principal} currency="MUSD" />
          </LedgerRow>
          <LedgerRow label="Still owed to lenders" last>
            <Amount
              value={
                existingAdvance.seniorPrincipalDue +
                existingAdvance.juniorPrincipalDue +
                existingAdvance.seniorFeeDue +
                existingAdvance.juniorFeeDue +
                existingAdvance.protocolFeeDue
              }
              currency="MUSD"
            />
          </LedgerRow>
        </LedgerSheet>
      )}

      {canAdvance && (
        <LedgerSheet className="mt-6">
          <LedgerSheetHeader>
            <span className="text-[15px] text-ink">Get an advance</span>
          </LedgerSheetHeader>
          <div className="p-5">
            <p className="mb-3 text-sm text-ink-soft">
              Up to <span className="font-medium text-ink">{formatUnits18(quote.maxAdvance)} MUSD</span> available,
              at {formatBps(quote.feePer30dBps)} per 30 days
              {quote.recourseBps > 0 ? `, with ${formatBps(quote.recourseBps)} recourse collateral` : ""}.
            </p>
            <Label>Amount to advance</Label>
            <Input
              value={advanceAmount}
              onChange={(e) => setAdvanceAmount(e.target.value)}
              placeholder="1,600.00"
              inputMode="decimal"
            />
            {requested > 0n && (
              <p className="mt-3 text-sm text-ink-soft">
                Estimated fee: <span className="tabular text-ink">{formatUnits18(projectedFee)} MUSD</span>
              </p>
            )}
            {error && <p className="mt-3 border border-red/30 bg-red-soft px-4 py-3 text-sm text-red">{error}</p>}
            <Button variant="primary" className="mt-4" onClick={handleAdvance} disabled={status === "working" || requested === 0n}>
              {status === "working" ? "Processing…" : "Get advance"}
            </Button>
          </div>
        </LedgerSheet>
      )}
    </div>
  );
}
