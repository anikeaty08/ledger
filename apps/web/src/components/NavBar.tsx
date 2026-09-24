"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/invoices/new", label: "New invoice" },
  { href: "/invoices", label: "Invoices" },
  { href: "/position", label: "Position" },
  { href: "/lend", label: "Lend" },
];

export function NavBar() {
  return (
    <header className="border-b border-rule bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>
        <nav className="hidden gap-7 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[15px] text-ink/80 hover:text-ink transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>
    </header>
  );
}
