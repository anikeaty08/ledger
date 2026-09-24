import { formatUnits18 } from "@/lib/format";

/** Every dollar amount in the product renders through this component: tabular mono digits, MUSD in
 *  plain ink (it's "just money" — no special color), BTC in the muted-gold accent, never a coin icon. */
export function Amount({
  value,
  currency,
  decimals = 2,
  size = "base",
  className = "",
}: {
  value: bigint;
  currency: "MUSD" | "BTC";
  decimals?: number;
  size?: "sm" | "base" | "lg" | "xl";
  className?: string;
}) {
  const sizeClass = {
    sm: "text-sm",
    base: "text-base",
    lg: "text-2xl",
    xl: "text-4xl",
  }[size];

  const colorClass = currency === "BTC" ? "text-gold" : "text-ink";

  return (
    <span className={`tabular font-mono ${sizeClass} ${colorClass} ${className}`}>
      {formatUnits18(value, decimals)}
      <span className="ml-1 text-[0.7em] font-sans font-medium opacity-60">{currency}</span>
    </span>
  );
}
