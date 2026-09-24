import Link from "next/link";
import { LedgerEntryHero } from "@/components/LedgerEntryHero";
import { StatBar } from "@/components/StatBar";
import { Button, LedgerSheet, LedgerSheetHeader } from "@/components/Ledger";

export default function HomePage() {
  return (
    <div>
      {/* ── Hero ── */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          <div>
            <h1 className="max-w-[16ch] text-[48px] font-semibold leading-[1.06] tracking-[-0.01em] text-ink sm:text-[58px]">
              Get paid before your client pays.
            </h1>
            <p className="mt-7 max-w-prose text-lg leading-relaxed text-ink-soft">
              Ledger turns a client-accepted invoice into an instant MUSD advance, backed by Bitcoin on
              Mezo. Your client pays on their own schedule. You don&apos;t wait for it.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/invoices/new">
                <Button variant="primary">Create your first invoice</Button>
              </Link>
              <Link href="/lend">
                <Button variant="secondary">Lend MUSD instead</Button>
              </Link>
            </div>
            <p className="mt-6 text-sm text-ink-soft">
              No signup. Connect a wallet and send your first invoice in under a minute.
            </p>
          </div>
          <LedgerEntryHero />
        </div>
      </section>

      {/* ── Live stats ── */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <StatBar />
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-rule bg-paper-dim">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="max-w-[22ch] text-[32px] font-semibold leading-tight text-ink">
            From invoice to money in your account, in three steps.
          </h2>
          <div className="mt-14 grid gap-px border border-rule bg-rule md:grid-cols-3">
            {[
              {
                step: "Send an invoice",
                body: "Describe the work, set an amount and due date. The details are encrypted in your browser before anything leaves it — only your client's link can decrypt them.",
              },
              {
                step: "Your client accepts",
                body: "They open the link and accept with a signature — no gas, no wallet setup on their end beyond what they already have. That acceptance is what turns the invoice into a financeable receivable.",
              },
              {
                step: "You get an advance",
                body: "Pull up to 80% of the invoice in MUSD immediately, priced by your client's own on-chain payment history. When they pay, the advance is repaid automatically and the rest lands with you.",
              },
            ].map((item, i) => (
              <div key={item.step} className="bg-paper p-7">
                <div className="font-mono text-sm text-ink-soft">0{i + 1}</div>
                <h3 className="mt-3 text-[18px] font-medium text-ink">{item.step}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Two audiences ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-8 lg:grid-cols-2">
          <LedgerSheet>
            <LedgerSheetHeader>
              <span className="text-[15px] text-ink">For freelancers and agencies</span>
            </LedgerSheetHeader>
            <div className="p-7">
              <h3 className="text-[22px] font-medium leading-snug text-ink">
                Stop carrying your client&apos;s cash-flow risk.
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                Net-60 terms shouldn&apos;t mean 60 days of your own money tied up. Get an advance the
                moment your invoice is accepted, split payouts automatically across your team, and keep
                any BTC your clients pay you in as collateral instead of selling it.
              </p>
              <Link href="/invoices/new" className="mt-5 inline-block text-[15px] font-medium text-red hover:underline">
                Create an invoice →
              </Link>
            </div>
          </LedgerSheet>

          <LedgerSheet>
            <LedgerSheetHeader>
              <span className="text-[15px] text-ink">For MUSD holders</span>
            </LedgerSheetHeader>
            <div className="p-7">
              <h3 className="text-[22px] font-medium leading-snug text-ink">
                Yield backed by real invoices, not DeFi loops.
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
                Fund advances through a senior or junior tranche. Senior is repaid first, with instant
                withdrawals. Junior earns more for taking first loss on a default — each client&apos;s
                on-chain payment record sets how much recourse collateral backs every advance.
              </p>
              <Link href="/lend" className="mt-5 inline-block text-[15px] font-medium text-red hover:underline">
                See current rates →
              </Link>
            </div>
          </LedgerSheet>
        </div>
      </section>

      {/* ── Trust model ── */}
      <section id="pricing" className="border-t border-rule bg-paper-dim">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-14 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <h2 className="text-[32px] font-semibold leading-tight text-ink">
                Pricing is set by your client&apos;s own record, not a credit check.
              </h2>
              <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-ink-soft">
                Every settled invoice adds to a client&apos;s public, on-chain payment history. A new
                client can still be financed on day one — they just need to post recourse collateral,
                which shrinks to zero as their record builds.
              </p>
            </div>
            <div className="border border-rule bg-paper">
              {[
                { tier: "New", advance: "50%", recourse: "100%" },
                { tier: "Bronze", advance: "60%", recourse: "50%" },
                { tier: "Silver", advance: "70%", recourse: "20%" },
                { tier: "Gold", advance: "80%", recourse: "0%" },
              ].map((row, i, arr) => (
                <div
                  key={row.tier}
                  className={`grid grid-cols-3 items-center px-6 py-4 ${i === arr.length - 1 ? "" : "border-b border-rule-soft"}`}
                >
                  <span className="text-[15px] text-ink">{row.tier}</span>
                  <span className="tabular text-right font-mono text-[15px] text-ink-soft">
                    up to {row.advance}
                  </span>
                  <span className="tabular text-right font-mono text-[15px] text-ink-soft">
                    {row.recourse} recourse
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Non-custodial / transparency ── */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 sm:grid-cols-3">
          {[
            {
              title: "Non-custodial",
              body: "Ledger never holds your funds or your private keys. Every advance and payment moves directly between your wallet and the contracts.",
            },
            {
              title: "Open source",
              body: "Every contract is public and verifiable on-chain. Nothing about how advances are priced or repaid happens off-chain or behind an API.",
            },
            {
              title: "Bitcoin-backed",
              body: "MUSD is minted against BTC collateral on Mezo, not an off-chain reserve. You can keep the BTC your clients pay you in, not just spend it.",
            },
          ].map((item) => (
            <div key={item.title}>
              <h3 className="ledger-close pb-2 text-[17px] font-medium text-ink">{item.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Fees ── */}
      <section className="border-t border-rule">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-14 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <h2 className="text-[32px] font-semibold leading-tight text-ink">
                What an advance costs, in full.
              </h2>
              <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-ink-soft">
                A discount fee is set when you take the advance, not adjusted later. It scales with how
                long until the invoice is due — shorter tenors cost less.
              </p>
            </div>
            <LedgerSheet>
              <LedgerSheetHeader>
                <span className="text-[15px] text-ink">Discount fee, per 30 days</span>
              </LedgerSheetHeader>
              {[
                { tier: "New", rate: "2.00%" },
                { tier: "Bronze", rate: "1.60%" },
                { tier: "Silver", rate: "1.20%" },
                { tier: "Gold", rate: "0.90%" },
              ].map((row, i, arr) => (
                <div
                  key={row.tier}
                  className={`flex items-baseline justify-between px-6 py-4 ${i === arr.length - 1 ? "" : "border-b border-rule-soft"}`}
                >
                  <span className="text-[15px] text-ink-soft">{row.tier} client</span>
                  <span className="tabular font-mono text-[15px] text-ink">{row.rate}</span>
                </div>
              ))}
              <div className="border-t border-rule bg-paper-dim px-6 py-4 text-[13px] text-ink-soft">
                Example: a $2,000 invoice, 60 days out, from a Silver-tier client — advance up to
                $1,400, fee $33.60.
              </div>
            </LedgerSheet>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="border-t border-rule bg-paper-dim">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-[32px] font-semibold leading-tight text-ink">Questions</h2>
          <div className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
            {[
              {
                q: "What if my client doesn't pay?",
                a: "For new and lower-tier clients, recourse collateral you post at the time of the advance covers the shortfall first. As a client's on-chain payment record builds, the collateral required drops toward zero.",
              },
              {
                q: "Can my client pay in Bitcoin?",
                a: "Yes. You can either convert it to MUSD automatically, or keep it as collateral in your own MUSD position instead of selling it.",
              },
              {
                q: "Does Ledger ever hold my money?",
                a: "No. Advances and payments move directly between your wallet, your client's wallet, and the contracts. There's no custodial account in between.",
              },
              {
                q: "What happens to the description I write?",
                a: "It's encrypted in your browser before it's sent anywhere. The decryption key lives only in the link you send your client — never on a server.",
              },
            ].map((item) => (
              <div key={item.q}>
                <h3 className="text-[16px] font-medium text-ink">{item.q}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing CTA ── */}
      <section className="border-t border-rule bg-ink">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="mx-auto max-w-[20ch] text-[32px] font-semibold leading-tight text-paper">
            Send your next invoice through Ledger.
          </h2>
          <p className="mx-auto mt-4 max-w-prose text-[15px] text-paper/70">
            Your client pays the same way they always have. You don&apos;t have to wait for it.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/invoices/new">
              <Button variant="primary">Create your first invoice</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
