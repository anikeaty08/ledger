import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, requireEnv } from "./env.js";

export const mezoTestnet = {
  id: env.chainId,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [env.rpcUrl] } },
} as const;

export const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(env.rpcUrl) });

export function getWalletClient() {
  const key = requireEnv("keeperPrivateKey");
  const account = privateKeyToAccount(key);
  return { account, wallet: createWalletClient({ account, chain: mezoTestnet, transport: http(env.rpcUrl) }) };
}
