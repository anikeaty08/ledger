import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";

/** Mezo testnet chain definition (see mezo-org/chains for the canonical Viem config). */
export const mezoTestnet = {
  id: env.CHAIN_ID,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [env.RPC_URL] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: env.EXPLORER_URL } },
} as const;

export const publicClient = createPublicClient({
  chain: mezoTestnet,
  transport: http(env.RPC_URL),
});

/**
 * The relayer submits transactions the user has already authorized with their own signature
 * (client invoice acceptance, `*WithSignature` position ops). It pays gas only — it never holds user
 * funds and cannot construct a payload the user did not sign.
 */
export const relayerAccount = env.RELAYER_PRIVATE_KEY ? privateKeyToAccount(env.RELAYER_PRIVATE_KEY) : undefined;

export const relayerClient = relayerAccount
  ? createWalletClient({ account: relayerAccount, chain: mezoTestnet, transport: http(env.RPC_URL) })
  : undefined;

export function requireAddress(name: string, value: Address | undefined): Address {
  if (!value) throw new Error(`${name} is not configured — set it in .env after deployment`);
  return value;
}
