import { LedgerSheet } from "./Ledger";

/** Shown instead of crashing whenever a screen needs a contract address that isn't configured yet.
 *  See contracts/README.md "Deploying" — this is expected before Wave 1's deployment, not a bug. */
export function NotDeployed({ what = "This" }: { what?: string }) {
  return (
    <LedgerSheet>
      <div className="p-8 text-center text-ink-soft">
        {what} isn&apos;t available yet — the contracts haven&apos;t been deployed to this network.
      </div>
    </LedgerSheet>
  );
}
