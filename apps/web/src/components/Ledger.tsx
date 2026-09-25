import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

/** The one container shape: a raised panel with hairline rules between rows. */
export function LedgerSheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel overflow-hidden rounded-lg ${className}`}>{children}</div>;
}

/** One ruled row: label left, value right, the accounting-column layout. */
export function LedgerRow({
  label,
  children,
  last = false,
}: {
  label: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 px-5 py-3.5 ${last ? "" : "border-b border-rule-soft"}`}
    >
      <span className="text-[14px] text-ink-soft">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function LedgerSheetHeader({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 border-b border-rule px-5 py-3.5">{children}</div>;
}

type Variant = "primary" | "secondary" | "ghost";

function buttonClass(variant: Variant, className: string) {
  const base =
    "btn inline-flex min-h-[44px] items-center justify-center gap-2 rounded border px-[18px] text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary: "border-accent-strong bg-accent-strong text-white hover:brightness-110",
    secondary: "border-rule-strong bg-paper-dim text-ink hover:border-accent",
    ghost: "border-transparent text-ink-soft hover:bg-paper-raised hover:text-ink",
  };
  return `${base} ${variants[variant]} ${className}`;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button className={buttonClass(variant, className)} {...props}>
      {children}
    </button>
  );
}

/** A navigation that looks like a button: one real link, one tab stop. */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-[46px] w-full rounded-[10px] border border-rule bg-paper-dim px-3.5 text-[15px] text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-ink-faint hover:border-rule-strong focus:border-accent focus:shadow-[0_0_0_3px_rgb(var(--c-accent)/0.15)] focus:outline-none aria-[invalid=true]:border-red ${props.className ?? ""}`}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] text-ink-soft">
      {children}
    </label>
  );
}

/** Inline error, announced to screen readers the moment it appears. */
export function Notice({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={`flex items-start gap-2.5 rounded border border-red/25 bg-red-soft px-4 py-3 text-sm text-red ${className}`}>
      <Icon name="error" size={16} className="mt-0.5" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** A screen that needs something first (a wallet, a sign-in): says what, why, and the one action. */
export function Gate({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-20">
      <h1 className="text-[32px] font-bold tracking-[-0.04em] text-ink">{title}</h1>
      <p className="mt-2 text-ink-soft">{body}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** Placeholder bars in the same ruled layout as the content they stand in for. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <LedgerSheet>
      <span className="sr-only" role="status">
        Loading
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={`flex items-center justify-between gap-6 px-5 py-4 ${i === rows - 1 ? "" : "border-b border-rule-soft"}`}
        >
          <span className="ledger-skeleton h-3.5 w-24" />
          <span className="ledger-skeleton h-3.5 w-20" />
        </div>
      ))}
    </LedgerSheet>
  );
}
