import type { Address } from "viem";

function optionalAddress(v: string | undefined): Address | undefined {
  return v && v.startsWith("0x") ? (v as Address) : undefined;
}

/** Undefined until the deploy script has run and .env is filled in — see contracts/README.md. */
export const addresses = {
  invoiceRegistry: optionalAddress(process.env.NEXT_PUBLIC_INVOICE_REGISTRY_ADDRESS),
  receivableNft: optionalAddress(process.env.NEXT_PUBLIC_RECEIVABLE_NFT_ADDRESS),
  advanceEngine: optionalAddress(process.env.NEXT_PUBLIC_ADVANCE_ENGINE_ADDRESS),
  settlementRouter: optionalAddress(process.env.NEXT_PUBLIC_SETTLEMENT_ROUTER_ADDRESS),
  reputationRegistry: optionalAddress(process.env.NEXT_PUBLIC_REPUTATION_REGISTRY_ADDRESS),
  seniorVault: optionalAddress(process.env.NEXT_PUBLIC_SENIOR_VAULT_ADDRESS),
  juniorVault: optionalAddress(process.env.NEXT_PUBLIC_JUNIOR_VAULT_ADDRESS),
  ledgerAccountFactory: optionalAddress(process.env.NEXT_PUBLIC_LEDGER_ACCOUNT_FACTORY_ADDRESS),
  musd: optionalAddress(process.env.NEXT_PUBLIC_MUSD_ADDRESS),
} as const;

export function requireAddress(name: keyof typeof addresses): Address {
  const v = addresses[name];
  if (!v) {
    throw new Error(
      `${name} is not configured. Contracts aren't deployed yet — see contracts/README.md "Deploying".`,
    );
  }
  return v;
}

export const isDeployed = Object.values(addresses).every(Boolean);
