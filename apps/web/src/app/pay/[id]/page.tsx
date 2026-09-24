"use client";

import { use, useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract, useSignTypedData } from "wagmi";
import { parseAbi } from "viem";
import { LedgerSheet, LedgerSheetHeader, LedgerRow, Button } from "@/components/Ledger";
import { Amount } from "@/components/Amount";
import { StatusBadge } from "@/components/StatusBadge";
import { NotDeployed } from "@/components/NotDeployed";
import { getInvoiceBlob, relayAcceptInvoice, ApiError } from "@/lib/api";
import { decryptTerms, type InvoiceTerms } from "@/lib/crypto";
import { InvoiceStatus, formatDate, daysUntil } from "@/lib/format";
import { addresses, requireAddress } from "@/lib/addresses";
import { invoiceRegistryAbi } from "@/lib/abis/invoiceRegistry";
import { settlementRouterAbi } from "@/lib/abis/settlementRouter";

const erc20ApproveAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; terms: InvoiceTerms | null; amount: bigint; dueDate: bigint; issuer: `0x${string}` };

export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const invoiceId = BigInt(id);
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [actionState, setActionState] = useState<"idle" | "working" | "done">("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const deployed = !!addresses.invoiceRegistry;

  const { data: onchainInvoice, refetch: refetchInvoice } = useReadContract({
    address: addresses.invoiceRegistry,
    abi: invoiceRegistryAbi,
    functionName: "getInvoice",
    args: [invoiceId],
    query: { enabled: deployed },
  });

  const { data: owed, refetch: refetchOwed } = useReadContract({
    address: addresses.invoiceRegistry,
    abi: invoiceRegistryAbi,
    functionName: "amountOwed",
    args: [invoiceId],
    query: { enabled: deployed },
  });

  useEffect(() => {
    async function load() {
      try {
        const blob = await getInvoiceBlob(invoiceId);
        const fragment = window.location.hash;
        const key = fragment.startsWith("#k=") ? fragment.slice(3) : null;

        let terms: InvoiceTerms | null = null;
        if (key && blob.ciphertext && blob.iv) {
          terms = await decryptTerms(blob.ciphertext, blob.iv, key);
        }

        setState({
          kind: "ready",
          terms,
          amount: BigInt(blob.chain?.amount ?? "0"),
          dueDate: BigInt(blob.chain?.dueDate ? Math.floor(new Date(blob.chain.dueDate).getTime() / 1000) : 0),
          issuer: blob.chain?.issuer ?? "0x0000000000000000000000000000000000000000",
        });
      } catch (err) {
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "Couldn't load this invoice." });
      }
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!deployed) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <NotDeployed what="Payments" />
      </div>
    );
  }
  if (state.kind === "loading") {
    return <div className="mx-auto max-w-xl px-6 py-16 text-ink-soft">Loading invoice…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <p className="border border-red/30 bg-red-soft px-4 py-3 text-red">{state.message}</p>
      </div>
    );
  }

  const status = onchainInvoice?.status ?? InvoiceStatus.Issued;
  const amount = onchainInvoice?.amount ?? state.amount;

  async function handleAccept() {
    if (!address) return;
    setActionState("working");
    setActionError(null);
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const digest = await publicClient!.readContract({
        address: requireAddress("invoiceRegistry"),
        abi: invoiceRegistryAbi,
        functionName: "acceptanceDigest",
        args: [invoiceId, address, deadline],
      });
      void digest; // the contract recomputes this itself; fetched above only to fail fast if the invoice doesn't exist

      const signature = await signTypedDataAsync({
        domain: { name: "Ledger", version: "1", chainId: publicClient!.chain.id, verifyingContract: requireAddress("invoiceRegistry") },
        types: {
          InvoiceAcceptance: [
            { name: "invoiceId", type: "uint256" },
            { name: "commitment", type: "bytes32" },
            { name: "amount", type: "uint256" },
            { name: "dueDate", type: "uint64" },
            { name: "payer", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "InvoiceAcceptance",
        message: {
          invoiceId,
          commitment: onchainInvoice!.commitment,
          amount: BigInt(onchainInvoice!.amount),
          dueDate: onchainInvoice!.dueDate,
          payer: address,
          deadline,
        },
      });

      await relayAcceptInvoice({ invoiceId, payer: address, deadline, signature });
      await refetchInvoice();
      setActionState("done");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't accept this invoice.");
      setActionState("idle");
    }
  }

  async function handlePayMUSD() {
    if (!address || !owed) return;
    setActionState("working");
    setActionError(null);
    try {
      const musd = requireAddress("musd");
      const allowance = await publicClient!.readContract({
        address: musd,
        abi: erc20ApproveAbi,
        functionName: "allowance",
        args: [address, requireAddress("settlementRouter")],
      });
      if (allowance < owed) {
        const approveHash = await writeContractAsync({
          address: musd,
          abi: erc20ApproveAbi,
          functionName: "approve",
          args: [requireAddress("settlementRouter"), owed],
        });
        await publicClient!.waitForTransactionReceipt({ hash: approveHash });
      }
      const payHash = await writeContractAsync({
        address: requireAddress("settlementRouter"),
        abi: settlementRouterAbi,
        functionName: "pay",
        args: [invoiceId, owed],
      });
      await publicClient!.waitForTransactionReceipt({ hash: payHash });
      await Promise.all([refetchInvoice(), refetchOwed()]);
      setActionState("done");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Payment failed.");
      setActionState("idle");
    }
  }

  const isMine = address && state.issuer.toLowerCase() === address.toLowerCase();
  const canAccept = status === InvoiceStatus.Issued && !isMine;
  const canPay =
    owed !== undefined &&
    owed > 0n &&
    [InvoiceStatus.Accepted, InvoiceStatus.Financed, InvoiceStatus.PartiallyPaid, InvoiceStatus.Overdue].includes(
      status,
    );
  const isSettled = status === InvoiceStatus.Settled;

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Invoice #{id}</h1>
        <StatusBadge status={status} />
      </div>

      <LedgerSheet>
        <LedgerSheetHeader>
          <span className="text-[15px] text-ink-soft">
            {state.terms?.description ?? "Encrypted — you need the original link to view details"}
          </span>
        </LedgerSheetHeader>
        <LedgerRow label="Amount">
          <Amount value={amount} currency="MUSD" size="lg" />
        </LedgerRow>
        <LedgerRow label="Due">{formatDate(onchainInvoice?.dueDate ?? state.dueDate)}</LedgerRow>
        {owed !== undefined && owed !== amount && (
          <LedgerRow label="Amount owed now" last>
            <Amount value={owed} currency="MUSD" />
          </LedgerRow>
        )}
      </LedgerSheet>

      {isSettled ? (
        <p className="mt-6 text-ink-soft">This invoice has been paid in full. Thank you.</p>
      ) : !isConnected ? (
        <p className="mt-6 text-ink-soft">Connect a wallet to accept or pay this invoice.</p>
      ) : canAccept ? (
        <div className="mt-6">
          <p className="mb-3 text-sm text-ink-soft">
            Accepting confirms you owe this amount. It costs no gas — you only sign a message.
          </p>
          <Button variant="primary" onClick={handleAccept} disabled={actionState === "working"}>
            {actionState === "working" ? "Confirm in wallet…" : "Accept invoice"}
          </Button>
        </div>
      ) : canPay ? (
        <div className="mt-6 flex gap-3">
          <Button variant="primary" onClick={handlePayMUSD} disabled={actionState === "working"}>
            {actionState === "working" ? "Processing…" : "Pay with MUSD"}
          </Button>
          <Button variant="secondary" disabled title="BTC payment UI coming — the contract call is wired in settlementRouterAbi.payWithBTC">
            Pay with BTC
          </Button>
        </div>
      ) : null}

      {actionError && <p className="mt-4 border border-red/30 bg-red-soft px-4 py-3 text-sm text-red">{actionError}</p>}
    </div>
  );
}
