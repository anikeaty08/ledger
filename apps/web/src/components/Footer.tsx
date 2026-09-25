import Link from "next/link";
import { LogoMark } from "./Logo";
import { Icon } from "./Icon";

const COLUMNS: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Create an invoice", href: "/invoices/new" },
      { label: "Your invoices", href: "/invoices" },
      { label: "Your position", href: "/position" },
      { label: "Lend MUSD", href: "/lend" },
    ],
  },
  {
    heading: "How it works",
    links: [
      { label: "Advance pricing", href: "/#pricing" },
      { label: "Senior & junior tranches", href: "/lend" },
      { label: "Keep-BTC positions", href: "/position" },
      { label: "Payment records", href: "/invoices" },
    ],
  },
  {
    heading: "Built on Mezo",
    links: [
      { label: "MUSD", href: "https://mezo.org/docs", external: true },
      { label: "Mezo network", href: "https://mezo.org", external: true },
      { label: "Testnet explorer", href: "https://explorer.test.mezo.org", external: true },
      { label: "Testnet faucet", href: "https://faucet.test.mezo.org", external: true },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "Source code", href: "https://github.com/anikeaty08/ledger", external: true },
      { label: "System design", href: "https://github.com/anikeaty08/ledger/blob/main/docs/SYSTEM_DESIGN.md", external: true },
      { label: "Contracts", href: "https://github.com/anikeaty08/ledger/tree/main/contracts", external: true },
      { label: "API", href: "https://github.com/anikeaty08/ledger/tree/main/apps/api", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-rule bg-paper-dim">
      <div className="mx-auto grid max-w-site gap-12 px-5 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] lg:px-8">
        <div>
          <Link href="/" className="inline-flex items-center gap-3" aria-label="Ledger home">
            <LogoMark size={30} />
            <span className="text-[17px] font-bold tracking-[-0.035em] text-ink">Ledger</span>
          </Link>
          <p className="mt-5 max-w-sm text-[14px] leading-6 text-ink-soft">
            A Bitcoin-backed business account for freelancers. Get paid on your own schedule, not your
            client&apos;s.
          </p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-rule bg-paper px-3 py-1.5 text-[12px] text-ink-soft">
            <span className="pulse-soft h-2 w-2 rounded-full bg-ok" aria-hidden="true" />
            Live on Mezo testnet
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <h2 className="kicker">{col.heading}</h2>
            <ul className="mt-5 space-y-3">
              {col.links.map((link) => (
                <li key={link.label}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[14px] text-ink-soft transition-colors hover:text-ink"
                    >
                      {link.label}
                      <Icon name="external-link" size={16} />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : (
                    <Link href={link.href} className="text-[14px] text-ink-soft transition-colors hover:text-ink">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-rule">
        <div className="mx-auto flex max-w-site flex-col gap-2 px-5 py-6 text-[12px] text-ink-faint sm:flex-row sm:justify-between lg:px-8">
          <span>© {new Date().getFullYear()} Ledger. Non-custodial, Bitcoin-backed, on Mezo.</span>
          <span>Every contract is open source and verifiable on-chain.</span>
        </div>
      </div>
    </footer>
  );
}
