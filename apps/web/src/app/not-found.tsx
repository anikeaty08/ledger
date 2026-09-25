import { ButtonLink } from "@/components/Ledger";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <p className="font-mono text-sm text-ink-soft">404</p>
      <h1 className="ledger-close mt-3 pb-3 text-[32px] font-semibold leading-tight text-ink">
        There&apos;s no entry on this line.
      </h1>
      <p className="mt-5 text-ink-soft">
        The page or invoice you asked for doesn&apos;t exist. If you followed a pay link, check that you copied
        all of it.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/invoices">Go to your invoices</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          Back to home
        </ButtonLink>
      </div>
    </div>
  );
}
