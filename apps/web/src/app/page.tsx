import Link from "next/link";
import { LedgerEntryHero } from "@/components/LedgerEntryHero";
import { StatBar } from "@/components/StatBar";
import { AdvanceCalculator } from "@/components/AdvanceCalculator";
import { HeroTwinkle } from "@/components/HeroTwinkle";
import { ButtonLink, LedgerSheet } from "@/components/Ledger";
import { Icon, type IconName } from "@/components/Icon";

type Point = { icon: IconName; title: string; body: string };

const STEPS: Point[] = [
  {
    icon: "invoice",
    title: "Send an invoice",
    body: "Describe the work, set an amount and due date. The details are encrypted in your browser before anything leaves it. Only your client's link can decrypt them.",
  },
  {
    icon: "accepted",
    title: "Your client accepts",
    body: "They open the link and accept with a signature. No gas, and no wallet setup beyond the wallet they already have. Acceptance turns the invoice into a financeable receivable.",
  },
  {
    icon: "advance",
    title: "You get an advance",
    body: "Pull up to 80% of the invoice in MUSD immediately, priced by your client's own on-chain payment history. When they pay, the advance is repaid automatically and the rest lands with you.",
  },
];

const TIERS = [
  { tier: "New", advance: "50%", fee: "2.00%", recourse: "100%" },
  { tier: "Bronze", advance: "60%", fee: "1.60%", recourse: "50%" },
  { tier: "Silver", advance: "70%", fee: "1.20%", recourse: "20%" },
  { tier: "Gold", advance: "80%", fee: "0.90%", recourse: "0%" },
];

const TRUST: Point[] = [
  {
    icon: "wallet",
    title: "Non-custodial",
    body: "Ledger never holds your funds or your private keys. Every advance and payment moves directly between your wallet and the contracts.",
  },
  {
    icon: "shield",
    title: "Open source",
    body: "Every contract is public and verifiable on-chain. Nothing about how advances are priced or repaid happens off-chain or behind an API.",
  },
  {
    icon: "bitcoin",
    title: "Bitcoin-backed",
    body: "MUSD is minted against BTC collateral on Mezo, not an off-chain reserve. You can keep the BTC your clients pay you in, not just spend it.",
  },
];

const AUDIENCES = [
  {
    label: "For freelancers and agencies",
    title: "Stop carrying your client's cash-flow risk.",
    body: "Net-60 terms shouldn't mean 60 days of your own money tied up. Get an advance the moment your invoice is accepted, split payouts across your team, and keep any BTC your clients pay you in as collateral instead of selling it.",
    href: "/invoices/new",
    cta: "Create an invoice",
  },
  {
    label: "For MUSD holders",
    title: "Yield backed by real invoices, not DeFi loops.",
    body: "Fund advances through a senior or junior tranche. Senior is repaid first, with instant withdrawals. Junior earns more for taking first loss on a default. Each client's on-chain payment record sets how much recourse collateral backs every advance.",
    href: "/lend",
    cta: "See the lending pools",
  },
];

const FAQ = [
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
    a: "It's encrypted in your browser before it's sent anywhere. The decryption key lives only in the link you send your client, never on a server.",
  },
];

function SectionHeading({ label, title, children }: { label: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-3xl">
      <p className="kicker">{label}</p>
      <h2 className="mt-5 text-[36px] font-bold leading-[1.05] tracking-[-0.045em] text-ink sm:text-[48px]">{title}</h2>
      {children && <p className="mt-6 max-w-2xl text-[16px] leading-7 text-ink-soft">{children}</p>}
    </div>
  );
}

function IconRow({ items }: { items: Point[] }) {
  return (
    <div className="mt-16 grid border-y border-rule md:grid-cols-3">
      {items.map((item, i) => (
        <div
          key={item.title}
          className={`py-9 md:px-8 ${i === 0 ? "md:pl-0" : "border-t border-rule md:border-l md:border-t-0"}`}
        >
          <Icon name={item.icon} size={32} className="text-accent" />
          <h3 className="mt-8 text-[20px] font-semibold tracking-[-0.02em] text-ink">{item.title}</h3>
          <p className="mt-3 text-[14px] leading-6 text-ink-soft">{item.body}</p>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="site-glow relative overflow-hidden border-b border-rule">
        <div
          aria-hidden="true"
          className="site-grid absolute inset-0 opacity-[0.16] [mask-image:linear-gradient(to_bottom,black,transparent_86%)]"
        />
        <HeroTwinkle />
        <div className="relative mx-auto grid max-w-site grid-cols-[minmax(0,1fr)] items-center gap-14 px-5 py-20 lg:min-h-[min(calc(100svh-4rem),58rem)] lg:grid-cols-12 lg:px-8">
          <div className="rise lg:col-span-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-rule bg-paper-dim px-3 py-2 text-[12px] text-ink-soft">
              <span className="pulse-soft h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
              Live on Mezo testnet
            </p>
            <h1 className="mt-8 text-[clamp(3rem,7vw,6.6rem)] font-bold leading-[0.92] tracking-[-0.06em] text-ink">
              Get paid before
              <br />
              <span className="text-accent">your client pays.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-[16px] leading-7 text-ink-soft sm:text-[18px]">
              Ledger turns a client-accepted invoice into an instant MUSD advance, backed by Bitcoin on Mezo. Your
              client pays on their own schedule. You don&apos;t wait for it.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/invoices/new" className="px-6">
                Create your first invoice <Icon name="arrow-right" size={16} />
              </ButtonLink>
              <ButtonLink href="/lend" variant="secondary" className="px-6">
                Lend MUSD instead
              </ButtonLink>
            </div>
            <ul className="mt-12 flex flex-wrap gap-x-8 gap-y-4 text-[12px] text-ink-soft">
              {["No signup, just a wallet", "Non-custodial", "Open-source contracts"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Icon name="check-circle" size={16} className="text-ok" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rise-delay lg:col-span-5">
            <LedgerEntryHero />
          </div>
        </div>
      </section>

      {/* Live pool stats */}
      <section className="border-b border-rule bg-paper-dim">
        <div className="mx-auto max-w-site px-5 py-10 lg:px-8">
          <StatBar />
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-site px-5 lg:px-8">
          <SectionHeading label="How it works" title="From invoice to money in your account, in three steps.">
            Every step happens on-chain from your own wallet. Ledger never takes custody of the invoice, the advance or
            the payment.
          </SectionHeading>
          <IconRow items={STEPS} />
        </div>
      </section>

      {/* Two audiences */}
      <section className="border-y border-rule bg-paper-dim py-24 sm:py-32">
        <div className="mx-auto grid max-w-site gap-6 px-5 lg:grid-cols-2 lg:px-8">
          {AUDIENCES.map((c) => (
            <div key={c.label} className="panel flex flex-col rounded-lg p-8 sm:p-10">
              <p className="kicker">{c.label}</p>
              <h3 className="mt-5 text-[28px] font-bold leading-tight tracking-[-0.04em] text-ink">{c.title}</h3>
              <p className="mt-4 flex-1 text-[15px] leading-7 text-ink-soft">{c.body}</p>
              <Link
                href={c.href}
                className="mt-8 inline-flex w-fit items-center gap-2 text-[14px] font-semibold text-accent transition-colors hover:text-ink"
              >
                {c.cta} <Icon name="arrow-right" size={16} />
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 py-24 sm:py-32">
        <div className="mx-auto grid max-w-site gap-12 px-5 lg:grid-cols-12 lg:items-center lg:px-8">
          <div className="lg:col-span-5">
            <SectionHeading label="Pricing" title="Set by your client's record, not a credit check.">
              Every settled invoice adds to a client&apos;s public, on-chain payment history. A new client can still be
              financed on day one: you post recourse collateral for them, which shrinks to zero as their record builds.
            </SectionHeading>
          </div>
          <LedgerSheet className="lg:col-span-7">
            <table className="w-full text-left">
              <caption className="sr-only">Advance terms by client tier</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th scope="col" className="kicker px-6 py-4">Client tier</th>
                  <th scope="col" className="kicker px-6 py-4 text-right">Advance</th>
                  <th scope="col" className="kicker px-6 py-4 text-right">Fee / 30d</th>
                  <th scope="col" className="kicker px-6 py-4 text-right">Recourse</th>
                </tr>
              </thead>
              <tbody>
                {TIERS.map((row, i) => (
                  <tr key={row.tier} className={i === TIERS.length - 1 ? "" : "border-b border-rule"}>
                    <th scope="row" className="px-6 py-5 text-[15px] font-semibold text-ink">
                      {row.tier}
                    </th>
                    <td className="tabular px-6 py-5 text-right font-mono text-[14px] text-ink">{row.advance}</td>
                    <td className="tabular px-6 py-5 text-right font-mono text-[14px] text-ink-soft">{row.fee}</td>
                    <td className="tabular px-6 py-5 text-right font-mono text-[14px] text-ink-soft">{row.recourse}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </LedgerSheet>
        </div>
      </section>

      {/* Calculator */}
      <section className="border-y border-rule bg-paper-dim py-24 sm:py-32">
        <div className="mx-auto grid max-w-site gap-12 px-5 lg:grid-cols-12 lg:items-start lg:px-8">
          <div className="lg:col-span-5">
            <SectionHeading label="Calculator" title="What an advance costs, in full.">
              The discount fee is fixed when you take the advance and scales with how long until the invoice is due,
              so shorter terms cost less. This runs the exact formula{" "}
              <code className="font-mono text-[14px] text-ink">AdvanceEngine.feeFor()</code> uses on-chain.
            </SectionHeading>
          </div>
          <div className="lg:col-span-7">
            <AdvanceCalculator />
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-site px-5 lg:px-8">
          <SectionHeading label="Trust model" title="Your keys, your funds, public rules." />
          <IconRow items={TRUST} />
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-rule bg-paper-dim py-24 sm:py-32">
        <div className="mx-auto grid max-w-site gap-12 px-5 lg:grid-cols-12 lg:px-8">
          <div className="lg:col-span-4">
            <SectionHeading label="FAQ" title="Questions" />
          </div>
          <div className="divide-y divide-rule border-y border-rule lg:col-span-8">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-6 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-semibold text-ink">
                  {item.q}
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rule text-[18px] leading-none text-ink-soft transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-4 max-w-[64ch] text-[15px] leading-7 text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-rule py-20">
        <div className="mx-auto flex max-w-site flex-col items-start justify-between gap-8 px-5 md:flex-row md:items-center lg:px-8">
          <div>
            <p className="kicker">Ledger app</p>
            <h2 className="mt-4 text-[30px] font-bold tracking-[-0.04em] text-ink">Send your next invoice through Ledger.</h2>
            <p className="mt-2 text-[15px] text-ink-soft">
              Your client pays the way they always have. You don&apos;t have to wait for it.
            </p>
          </div>
          <ButtonLink href="/invoices/new" className="px-6">
            Create an invoice <Icon name="arrow-right" size={16} />
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
