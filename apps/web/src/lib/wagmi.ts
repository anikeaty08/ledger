import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, walletConnectWallet, rainbowWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mezoTestnet } from "./chain";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "ledger-dev-placeholder";

// Deliberately NOT RainbowKit's getDefaultConfig(): its default wallet list includes the Coinbase/Base
// Account connector, which drags in @coinbase/cdp-sdk's optional x402 payment feature — a dependency
// chain that isn't actually installed (@x402/evm/upto/client) and breaks the Next.js build. Ledger has
// no use for Base's smart-wallet connector on a Mezo-only app, so this builds an explicit, minimal
// wallet list instead of pulling in the whole default kit.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet],
    },
  ],
  { appName: "Ledger", projectId },
);

export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors,
  transports: { [mezoTestnet.id]: http() },
  ssr: true,
});
