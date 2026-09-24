"use client";

import { useEffect, useState } from "react";

/**
 * The hero moment: a ledger entry writing itself in, one orchestrated sequence rather than scattered
 * fade-ins. This is the most characteristic thing in Ledger's world — the actual moment of a
 * receivable turning into an advance.
 */
export function LedgerEntryHero() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 300),
      setTimeout(() => setStep(2), 1400),
      setTimeout(() => setStep(3), 2500),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const line = (visible: boolean, extraDelay = "") => (visible ? `opacity-100 ${extraDelay}` : "opacity-0");

  return (
    <div className="border border-rule bg-paper font-mono text-[15px]">
      <div className="border-b border-rule px-5 py-3 text-sm text-ink-soft">Invoice #0057 · Acme Labs</div>
      <div className="space-y-0">
        <div
          className={`flex items-baseline justify-between border-b border-rule-soft px-5 py-3.5 transition-opacity duration-700 ${line(step >= 1)}`}
        >
          <span className="text-ink-soft">Client owes</span>
          <span className="tabular text-ink">2,000.00 MUSD</span>
        </div>
        <div
          className={`flex items-baseline justify-between border-b border-rule-soft px-5 py-3.5 transition-opacity duration-700 ${line(step >= 2)}`}
        >
          <span className="text-ink-soft">Advanced today</span>
          <span className="tabular text-red font-medium">1,600.00 MUSD</span>
        </div>
        <div
          className={`flex items-baseline justify-between px-5 py-3.5 transition-opacity duration-700 ${line(step >= 3)}`}
        >
          <span className="text-ink-soft">Balance</span>
          <span className="ledger-close tabular pb-1 text-ink">400.00 MUSD due Nov 18</span>
        </div>
      </div>
    </div>
  );
}
