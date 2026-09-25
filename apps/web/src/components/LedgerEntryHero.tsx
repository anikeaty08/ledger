"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const ROWS = [
  { label: "Invoice accepted by client", value: "2,000.00" },
  { label: "Advance paid out today", value: "1,600.00", accent: true },
  { label: "Client pays on Nov 18", value: "2,000.00" },
  { label: "Advance repaid, rest to you", value: "371.20", done: true },
];

/** The hero card: one invoice moving from accepted to settled, written in line by line. Numbers are the
 *  real Gold-tier formula: 80% advance, 0.90% per 30 days over 60 days. */
export function LedgerEntryHero() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(ROWS.length);
      return;
    }
    const timers = ROWS.map((_, i) => setTimeout(() => setStep(i + 1), 500 + i * 650));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div
      role="img"
      aria-label="Example: a 2,000 MUSD invoice is accepted, 1,600 MUSD is advanced today, the client pays on Nov 18, and after the advance and a 28.80 MUSD fee are repaid, 371.20 MUSD goes to you."
      className="panel rounded-lg p-5 sm:p-6"
    >
      <div className="flex items-center justify-between border-b border-rule pb-5">
        <div>
          <p className="kicker">Example invoice #0057</p>
          <p className="mt-2 text-[14px] text-ink-soft">Acme Labs · Gold tier · 60 days</p>
        </div>
        <Icon name="shield" size={28} className="text-accent" />
      </div>
      <ol className="mt-5 space-y-2">
        {ROWS.map((row, i) => (
          <li
            key={row.label}
            className={`flex items-center justify-between gap-4 rounded-[10px] border border-rule bg-paper px-4 py-3.5 transition-opacity duration-500 ${
              step > i ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="font-mono text-[12px] text-accent">0{i + 1}</span>
              <span className="truncate text-[14px] font-medium text-ink">{row.label}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className={`tabular font-mono text-[13px] ${row.accent ? "text-accent" : "text-ink-soft"}`}>
                {row.value}
              </span>
              {row.done ? (
                <Icon name="check-circle" size={16} className="text-ok" />
              ) : (
                <Icon name="arrow-right" size={16} className="text-ink-faint" />
              )}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 flex items-center justify-between border-t border-rule pt-4 text-[12px] text-ink-faint">
        <span>Amounts in MUSD</span>
        <span className="font-mono">Fee 28.80</span>
      </p>
    </div>
  );
}
