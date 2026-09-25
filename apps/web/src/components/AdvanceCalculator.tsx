"use client";

import { useMemo, useState } from "react";
import { LedgerSheet, LedgerSheetHeader, Input, Label } from "./Ledger";
import { Amount } from "./Amount";

/** Mirrors CreditPolicy's real tiers (contracts/src/credit/CreditPolicy.sol) — the same numbers shown
 *  in the pricing table, made interactive instead of static. Not a toy: this is the actual formula
 *  AdvanceEngine.feeFor() runs on-chain (amount × feePer30dBps × ceil(tenorDays/30), in basis points). */
const TIERS = [
  { name: "New", advanceRateBps: 5_000, feePer30dBps: 200, recourseBps: 10_000 },
  { name: "Bronze", advanceRateBps: 6_000, feePer30dBps: 160, recourseBps: 5_000 },
  { name: "Silver", advanceRateBps: 7_000, feePer30dBps: 120, recourseBps: 2_000 },
  { name: "Gold", advanceRateBps: 8_000, feePer30dBps: 90, recourseBps: 0 },
] as const;

function toWei(dollars: number): bigint {
  return BigInt(Math.round(dollars * 100)) * 10n ** 16n; // dollars -> 1e18, via cents to avoid float drift
}

/** A live, playable version of the pricing table: type an invoice and see exactly what Ledger would
 *  advance, on the real formula — not a static illustration of one example. */
export function AdvanceCalculator() {
  const [amount, setAmount] = useState("2000");
  const [tenorDays, setTenorDays] = useState(60);
  const [tierIndex, setTierIndex] = useState(2); // Silver, matching the footer's worked example

  // tierIndex only ever comes from mapping over TIERS itself (the tier buttons below), so this is
  // always in range — the fallback just satisfies noUncheckedIndexedAccess.
  const tier = TIERS[tierIndex] ?? TIERS[2];

  const result = useMemo(() => {
    const face = Math.max(0, Number(amount.replace(/,/g, "")) || 0);
    const maxAdvance = (face * tier.advanceRateBps) / 10_000;
    const periods = Math.max(1, Math.ceil(tenorDays / 30));
    const fee = (maxAdvance * tier.feePer30dBps * periods) / 10_000;
    const recourse = (maxAdvance * tier.recourseBps) / 10_000;
    const netToday = maxAdvance;
    const remainderOnPayment = face - maxAdvance - fee;
    return { face, maxAdvance, fee, recourse, netToday, remainderOnPayment };
  }, [amount, tenorDays, tier]);

  return (
    <LedgerSheet>
      <LedgerSheetHeader>
        <span className="font-mono text-[12px] text-accent">Advance calculator</span>
        <span className="text-[12px] text-ink-faint">Same formula as the contract</span>
      </LedgerSheetHeader>

      <div className="grid gap-6 p-6 md:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <div>
            <Label htmlFor="calc-amount">Invoice amount (MUSD)</Label>
            <Input
              id="calc-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
            />
          </div>

          <div>
            <Label htmlFor="calc-tenor">
              Days until due: <span className="tabular font-mono text-ink">{tenorDays}</span>
            </Label>
            <input
              id="calc-tenor"
              type="range"
              min={7}
              max={120}
              value={tenorDays}
              onChange={(e) => setTenorDays(Number(e.target.value))}
              className="ledger-slider w-full"
            />
          </div>

          <div>
            <span id="calc-tier" className="mb-1.5 block text-[13px] text-ink-soft">
              Client tier
            </span>
            <div className="flex gap-1.5" role="group" aria-labelledby="calc-tier">
              {TIERS.map((t, i) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => setTierIndex(i)}
                  aria-pressed={i === tierIndex}
                  className={`ledger-press min-h-[40px] flex-1 rounded border px-2 py-2 text-[13px] font-medium ${
                    i === tierIndex
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-rule text-ink-soft hover:border-rule-strong hover:text-ink"
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded border border-rule-soft bg-paper/60 p-5">
          <div className="border-b border-rule-soft pb-4">
            <span className="text-[13px] text-ink-soft">You&apos;d get today</span>
            <div className="mt-1">
              <Amount value={toWei(result.netToday)} currency="MUSD" size="xl" className="text-accent" />
            </div>
          </div>
          <div className="flex items-baseline justify-between border-b border-rule-soft py-3">
            <span className="text-[14px] text-ink-soft">Discount fee</span>
            <Amount value={toWei(result.fee)} currency="MUSD" />
          </div>
          {result.recourse > 0 && (
            <div className="flex items-baseline justify-between border-b border-rule-soft py-3">
              <span className="text-[14px] text-ink-soft">Recourse collateral needed</span>
              <Amount value={toWei(result.recourse)} currency="MUSD" />
            </div>
          )}
          <div className="flex items-baseline justify-between pt-3">
            <span className="text-[14px] text-ink-soft">When they pay, you get the rest</span>
            <Amount value={toWei(Math.max(0, result.remainderOnPayment))} currency="MUSD" />
          </div>
        </div>
      </div>
    </LedgerSheet>
  );
}
