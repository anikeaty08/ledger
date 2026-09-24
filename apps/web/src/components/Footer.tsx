import Link from "next/link";
import { LogoMark } from "./Logo";

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
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark size={26} />
              <span className="font-sans text-[19px] font-semibold text-ink">Ledger</span>
            </div>
            <p className="mt-4 max-w-[32ch] text-[14px] leading-relaxed text-ink-soft">
              A Bitcoin-backed business account for freelancers. Get paid on your own schedule, not
              your client&apos;s.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className="text-[13px] font-medium text-ink">{col.heading}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[14px] text-ink-soft transition-colors hover:text-ink"
                      >
                        {link.label}
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

        <div className="mt-14 flex flex-col gap-3 border-t border-rule-soft pt-6 text-[13px] text-ink-soft sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Ledger. Non-custodial. Bitcoin-backed, on Mezo.</span>
          <span>Every contract is open source and verifiable on-chain.</span>
        </div>
      </div>
    </footer>
  );
}
