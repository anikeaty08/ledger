"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { LedgerSheet, LedgerSheetHeader, Button, ButtonLink, Gate, Notice, SkeletonRows } from "@/components/Ledger";
import { Amount } from "@/components/Amount";
import { StatusBadge } from "@/components/StatusBadge";
import { listMyInvoices, ApiError } from "@/lib/api";
import { useSession } from "@/lib/useSession";
import { InvoiceStatus, formatDate } from "@/lib/format";

type Row = NonNullable<Awaited<ReturnType<typeof listMyInvoices>>[number]>;

export default function InvoicesPage() {
  const { isConnected } = useAccount();
  const { sessionAddress, ensureSession, loading: signingIn, error: signInError } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setRows(null);
    listMyInvoices()
      .then((r) => setRows(r.filter((x): x is Row => x !== null)))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Your invoices didn't load. They're safe on-chain; this is only the list view. Try again.",
        ),
      );
  }, []);

  useEffect(() => {
    if (sessionAddress) load();
  }, [sessionAddress, load]);

  if (!isConnected) {
    return (
      <Gate title="Your invoices" body="Connect the wallet you send invoices from to see them here.">
        <ConnectButton />
      </Gate>
    );
  }

  if (!sessionAddress) {
    return (
      <Gate
        title="Your invoices"
        body="Sign a message to prove this wallet is yours. It's free and doesn't send a transaction."
      >
        <Button variant="primary" onClick={() => ensureSession().catch(() => {})} disabled={signingIn}>
          {signingIn ? "Check your wallet…" : "Sign in"}
        </Button>
        {signInError && <Notice className="mt-4">{signInError}</Notice>}
      </Gate>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink">Your invoices</h1>
        <ButtonLink href="/invoices/new">New invoice</ButtonLink>
      </div>

      {error ? (
        <div>
          <Notice>{error}</Notice>
          <Button variant="secondary" className="mt-4" onClick={load}>
            Try again
          </Button>
        </div>
      ) : rows === null ? (
        <SkeletonRows rows={4} />
      ) : rows.length === 0 ? (
        <LedgerSheet>
          <div className="px-6 py-12 text-center">
            <p className="text-lg font-medium text-ink">No invoices yet</p>
            <p className="mx-auto mt-2 max-w-[44ch] text-[15px] text-ink-soft">
              Each invoice you send shows up here with its due date, amount and status, and you can take an
              advance on it once your client accepts.
            </p>
            <ButtonLink href="/invoices/new" className="mt-6">
              Create an invoice
            </ButtonLink>
          </div>
        </LedgerSheet>
      ) : (
        <LedgerSheet>
          <LedgerSheetHeader>
            <div className="grid w-full grid-cols-[1fr_auto_auto] gap-4 text-[13px] text-ink-soft sm:grid-cols-[1fr_auto_auto_auto] sm:gap-6">
              <span>Invoice</span>
              <span className="hidden sm:block">Due</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
            </div>
          </LedgerSheetHeader>
          <ul>
            {rows.map((row, i) => (
              <li key={row.invoiceId} className={i === rows.length - 1 ? "" : "border-b border-rule-soft"}>
                <Link
                  href={`/invoices/${row.invoiceId}`}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-rule-soft sm:grid-cols-[1fr_auto_auto_auto] sm:gap-6"
                >
                  <span className="font-mono text-sm text-ink">#{row.invoiceId}</span>
                  <span className="hidden text-sm text-ink-soft sm:block">
                    {formatDate(BigInt(Math.floor(new Date(row.dueDate).getTime() / 1000)))}
                  </span>
                  <Amount value={BigInt(row.amount)} currency="MUSD" className="text-right" />
                  <StatusBadge status={row.status as InvoiceStatus} />
                </Link>
              </li>
            ))}
          </ul>
        </LedgerSheet>
      )}
    </div>
  );
}
