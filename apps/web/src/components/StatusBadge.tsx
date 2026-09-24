import { InvoiceStatus, STATUS_LABEL, ruleStyleFor } from "@/lib/format";

/** The ledger-rule motif, not a colored icon badge: dashed while open, a solid closing double-rule
 *  once Settled, struck through if Defaulted/Cancelled — literally closing the ledger line. */
export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const style = ruleStyleFor(status);
  const isRed = status === InvoiceStatus.Overdue || status === InvoiceStatus.Defaulted;
  const isDisputed = status === InvoiceStatus.Disputed;

  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        className={[
          "relative inline-block h-[1px] w-6",
          style === "dashed" ? "border-t-2 border-dashed border-ink-soft" : "",
          style === "solid" ? "ledger-close" : "",
          style === "struck" ? "border-t-2 border-red" : "",
        ].join(" ")}
        aria-hidden="true"
      />
      <span
        className={
          isRed ? "text-red font-medium" : isDisputed ? "text-gold font-medium" : "text-ink-soft"
        }
      >
        {STATUS_LABEL[status]}
      </span>
    </span>
  );
}
