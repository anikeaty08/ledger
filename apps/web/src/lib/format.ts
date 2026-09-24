/** Mirrors contracts/src/libraries/Types.sol InvoiceStatus exactly — ordinals must stay in sync. */
export enum InvoiceStatus {
  None = 0,
  Issued = 1,
  Accepted = 2,
  Financed = 3,
  PartiallyPaid = 4,
  Overdue = 5,
  Disputed = 6,
  Settled = 7,
  Defaulted = 8,
  Cancelled = 9,
}

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  [InvoiceStatus.None]: "Unknown",
  [InvoiceStatus.Issued]: "Awaiting acceptance",
  [InvoiceStatus.Accepted]: "Accepted",
  [InvoiceStatus.Financed]: "Financed",
  [InvoiceStatus.PartiallyPaid]: "Partially paid",
  [InvoiceStatus.Overdue]: "Overdue",
  [InvoiceStatus.Disputed]: "Disputed",
  [InvoiceStatus.Settled]: "Settled",
  [InvoiceStatus.Defaulted]: "Defaulted",
  [InvoiceStatus.Cancelled]: "Cancelled",
};

/** Ledger-rule motif state, used by <StatusBadge>: dashed while open, solid once settled, struck
 *  through if defaulted or cancelled. Keeps the same visual language as the logo mark. */
export function ruleStyleFor(status: InvoiceStatus): "dashed" | "solid" | "struck" {
  if (status === InvoiceStatus.Settled) return "solid";
  if (status === InvoiceStatus.Defaulted || status === InvoiceStatus.Cancelled) return "struck";
  return "dashed";
}

/** Formats a 1e18-scaled on-chain amount as a tabular-figure MUSD/BTC string: "2,000.00". */
export function formatUnits18(value: bigint, decimals = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** 18n;
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals);
  const wholeStr = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeStr}${decimals > 0 ? "." + fracStr : ""}`;
}

export function parseUnits18(input: string): bigint {
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  const [wholeRaw = "", fracRaw = ""] = trimmed.split(".");
  const whole = BigInt(wholeRaw.replace(/,/g, "") || "0");
  const frac = (fracRaw + "0".repeat(18)).slice(0, 18);
  return whole * 10n ** 18n + BigInt(frac || "0");
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatDate(unixSeconds: bigint | number): string {
  const ms = Number(unixSeconds) * 1000;
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function daysUntil(unixSeconds: bigint | number): number {
  const ms = Number(unixSeconds) * 1000;
  return Math.ceil((ms - Date.now()) / (1000 * 60 * 60 * 24));
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
