import type { ReactNode } from "react";

/** The ruled data sheet: flat paper, thin structural rules, no drop shadows. This is the one
 *  container shape used everywhere instead of the SaaS rounded-card-with-soft-shadow default. */
export function LedgerSheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border border-rule bg-paper ${className}`}>{children}</div>;
}

/** One ruled row: label left, value right — the accounting-column layout (date · description ·
 *  amount), not a centered marketing block. */
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
      <span className="text-[15px] text-ink-soft">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function LedgerSheetHeader({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between border-b border-rule px-5 py-4">{children}</div>;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const base = "px-4 py-2.5 text-[15px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-red text-paper hover:bg-red/90",
    secondary: "border border-ink text-ink hover:bg-ink hover:text-paper",
    ghost: "text-ink-soft hover:text-ink",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-rule bg-paper px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-soft/60 focus:border-ink ${props.className ?? ""}`}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-[13px] text-ink-soft">{children}</label>;
}
