"use client";

import { use, useEffect, useState } from "react";
import { waitForReceipt, withGas } from "@/lib/tx";
import { useAccount, usePublicClient, useReadContract, useWriteContract, useSignTypedData } from "wagmi";
import { parseAbi } from "viem";
import { notFound } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LedgerSheet, LedgerSheetHeader, LedgerRow, Button, Notice, SkeletonRows } from "@/components/Ledger";
import { Icon } from "@/components/Icon";
import { Amount } from "@/components/Amount";
import { StatusBadge } from "@/components/StatusBadge";
import { NotDeployed } from "@/components/NotDeployed";
import { getInvoiceBlob, relayAcceptInvoice, ApiError } from "@/lib/api";
import { decryptTerms, type InvoiceTerms } from "@/lib/crypto";
import { InvoiceStatus, formatDate, formatUnits18 } from "@/lib/format";
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
  const validId = /^\d+$/.test(id);
  const invoiceId = validId ? BigInt(id) : 0n;
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [actionState, setActionState] = useState<"idle" | "working" | "done">("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const deployed = validId && !!addresses.invoiceRegistry;

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
    if (!validId) return;
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

  if (!validId) notFound();

  if (!deployed) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <NotDeployed what="Payments" />
      </div>
    );
  }
  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="mb-6 text-2xl font-semibold text-ink">Invoice #{id}</h1>
        <SkeletonRows rows={3} />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <h1 className="mb-6 text-2xl font-semibold text-ink">Invoice #{id}</h1>
        <Notice>{state.message} Check that you opened the full link you were sent, then reload the page.</Notice>
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
        const approveHash = await writeContractAsync(
          await withGas(publicClient!, address, {
            address: musd,
            abi: erc20ApproveAbi,
            functionName: "approve",
            args: [requireAddress("settlementRouter"), owed],
          }),
        );
        await waitForReceipt(publicClient!, approveHash);
      }
      const payHash = await writeContractAsync(
        await withGas(publicClient!, address, {
          address: requireAddress("settlementRouter"),
          abi: settlementRouterAbi,
          functionName: "pay",
          args: [invoiceId, owed],
        }),
      );
      await waitForReceipt(publicClient!, payHash);
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
          {state.terms ? (
            <span className="text-[15px] text-ink">{state.terms.description}</span>
          ) : (
            <span className="flex items-center gap-2 text-[15px] text-ink-soft">
              <Icon name="lock" size={16} />
              Description hidden. Open the full link you were sent to read it.
            </span>
          )}
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
        <p className="ledger-close mt-6 flex items-center gap-2 text-ink">
          <Icon name="check" size={16} />
          Paid in full. Nothing more is owed on this invoice.
        </p>
      ) : !isConnected ? (
        <div className="mt-6">
          <p className="mb-3 text-sm text-ink-soft">Connect a wallet to accept or pay this invoice.</p>
          <ConnectButton />
        </div>
      ) : canAccept ? (
        <div className="mt-6">
          <p className="mb-3 text-sm text-ink-soft">
            Accepting confirms you owe this amount by the due date. It costs no gas: you only sign a message.
          </p>
          <Button variant="primary" onClick={handleAccept} disabled={actionState === "working"}>
            {actionState === "working" ? "Confirm in your wallet…" : "Accept invoice"}
          </Button>
        </div>
      ) : canPay ? (
        <div className="mt-6">
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={handlePayMUSD} disabled={actionState === "working"}>
              {actionState === "working" ? "Confirm in your wallet…" : `Pay ${formatUnits18(owed)} MUSD`}
            </Button>
            <Button variant="secondary" disabled aria-describedby="btc-soon">
              Pay with BTC
            </Button>
          </div>
          <p id="btc-soon" className="mt-2 text-[13px] text-ink-soft">
            Paying in BTC isn&apos;t available on this page yet. Pay in MUSD for now.
          </p>
        </div>
      ) : isMine && status === InvoiceStatus.Issued ? (
        <p className="mt-6 text-sm text-ink-soft">
          This is your own invoice. Send this link to your client so they can accept it.
        </p>
      ) : null}

      {actionError && <Notice className="mt-4">{actionError}</Notice>}
    </div>
  );
}
