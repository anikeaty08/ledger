/** The Ledger mark: an accountant's reconciliation tick — the stroke made beside a balanced line
 *  item. Asymmetric on purpose (short stroke in, long stroke out), not a symmetric checkmark glyph.
 *  See brand/mark.svg and brand/logo.svg at the repo root for the source files. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="8" fill="#EDF2EA" />
      <path
        d="M16 34 L27 45 L49 19"
        stroke="#8B2E23"
        strokeWidth="6"
        strokeLinecap="square"
        strokeLinejoin="miter"
        fill="none"
      />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={26} />
      <span className="flex flex-col leading-none">
        <span className="font-sans font-semibold text-[19px] tracking-[-0.01em] text-ink">Ledger</span>
        <span className="ledger-close h-0 w-full" aria-hidden="true" />
      </span>
    </span>
  );
}
