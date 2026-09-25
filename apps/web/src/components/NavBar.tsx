"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Logo } from "./Logo";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/invoices/new", label: "New invoice" },
  { href: "/invoices", label: "Invoices" },
  { href: "/position", label: "Position" },
  { href: "/lend", label: "Lend" },
];

function isActive(pathname: string, href: string) {
  if (href === "/invoices") return pathname === "/invoices" || /^\/invoices\/\d/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-paper/[0.88] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-site items-center justify-between gap-4 px-5 lg:px-8">
        <Link href="/" className="shrink-0" aria-label="Ledger home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`relative py-1 text-[14px] transition-colors ${
                  active
                    ? "text-ink after:absolute after:inset-x-0 after:-bottom-[19px] after:h-px after:bg-accent"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
          <button
            type="button"
            className="btn inline-flex h-10 w-10 items-center justify-center rounded border border-rule-strong bg-paper-dim text-ink hover:border-accent md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name={open ? "close" : "menu"} size={24} />
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-rule bg-paper-dim md:hidden">
          <ul className="mx-auto max-w-site px-5 py-2">
            {LINKS.map((l) => {
              const active = isActive(pathname, l.href);
              return (
                <li key={l.href} className="border-b border-rule last:border-b-0">
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={`block py-3.5 text-[16px] ${
                      active ? "font-medium text-accent" : "text-ink-soft"
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
