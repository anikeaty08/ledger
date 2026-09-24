import { defineChain } from "viem";

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.test.mezo.org";
const explorerUrl = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.test.mezo.org";

export const mezoTestnet = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31611),
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: explorerUrl } },
  testnet: true,
});
