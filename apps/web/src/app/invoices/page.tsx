"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { LedgerSheet, LedgerSheetHeader, Button } from "@/components/Ledger";
import { Amount } from "@/components/Amount";
import { StatusBadge } from "@/components/StatusBadge";
import { listMyInvoices, ApiError } from "@/lib/api";
import { useSession } from "@/lib/useSession";
import { InvoiceStatus, formatDate } from "@/lib/format";

type Row = NonNullable<Awaited<ReturnType<typeof listMyInvoices>>[number]>;

export default function InvoicesPage() {
  const { isConnected } = useAccount();
  const { sessionAddress, ensureSession } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionAddress) return;
    listMyInvoices()
      .then((r) => setRows(r.filter((x): x is Row => x !== null)))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't load invoices."));
  }, [sessionAddress]);

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-ink-soft">Connect a wallet to see your invoices.</p>
      </div>
    );
  }

  if (!sessionAddress) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <Button variant="primary" onClick={() => ensureSession().catch(() => {})}>
          Sign in to view your invoices
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink">Your invoices</h1>
        <Link href="/invoices/new">
          <Button variant="primary">New invoice</Button>
        </Link>
      </div>

      {error && <p className="border border-red/30 bg-red-soft px-4 py-3 text-sm text-red">{error}</p>}

      {rows === null ? (
        <p className="text-ink-soft">Loading…</p>
      ) : rows.length === 0 ? (
        <LedgerSheet>
          <div className="p-8 text-center text-ink-soft">
            No invoices yet. <Link href="/invoices/new" className="text-ink underline">Create your first one</Link>.
          </div>
        </LedgerSheet>
      ) : (
        <LedgerSheet>
          <LedgerSheetHeader>
            <div className="grid w-full grid-cols-[1fr_auto_auto_auto] gap-6 text-[13px] text-ink-soft">
              <span>Invoice</span>
              <span>Due</span>
              <span>Amount</span>
              <span>Status</span>
            </div>
          </LedgerSheetHeader>
          {rows.map((row, i) => (
            <Link
              key={row.invoiceId}
              href={`/invoices/${row.invoiceId}`}
              className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 px-5 py-4 hover:bg-paper-dim ${
                i === rows.length - 1 ? "" : "border-b border-rule-soft"
              }`}
            >
              <span className="font-mono text-sm text-ink">#{row.invoiceId}</span>
              <span className="text-sm text-ink-soft">{formatDate(BigInt(Math.floor(new Date(row.dueDate).getTime() / 1000)))}</span>
              <Amount value={BigInt(row.amount)} currency="MUSD" />
              <StatusBadge status={row.status as InvoiceStatus} />
            </Link>
          ))}
        </LedgerSheet>
      )}
    </div>
  );
}
