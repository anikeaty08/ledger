import { LedgerSheet } from "./Ledger";

/** Shown instead of crashing whenever a screen needs a contract address that isn't configured yet.
 *  See contracts/README.md "Deploying": this is expected before deployment, not a bug. */
export function NotDeployed({ what = "These features" }: { what?: string }) {
  return (
    <LedgerSheet>
      <div className="p-8 text-center">
        <p className="text-ink">{what} aren&apos;t live on this network yet.</p>
        <p className="mt-1.5 text-sm text-ink-soft">
          The Ledger contracts haven&apos;t been deployed here, so there&apos;s nothing to read or sign.
        </p>
      </div>
    </LedgerSheet>
  );
}
