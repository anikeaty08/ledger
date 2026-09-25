/** The Ledger mark: an accountant's reconciliation tick, asymmetric on purpose (short stroke in, long
 *  stroke out). Source files live in brand/ at the repo root. */
export function LogoMark({
  size = 28,
  className = "",
  animated = false,
}: {
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ledger-mark-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2F86FF" />
          <stop offset="1" stopColor="#1554C0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#ledger-mark-bg)" />
      <path
        d="M17 34 L28 45 L48 20"
        stroke="#FFFFFF"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className={animated ? "ledger-mark-path" : undefined}
      />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={28} animated />
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Ledger</span>
    </span>
  );
}
