import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pins the workspace root explicitly — otherwise Next.js's file tracing gets confused by an
  // unrelated package-lock.json it finds up at the user's home directory.
  outputFileTracingRoot: __dirname,
  webpack: (config) => {
    // @coinbase/cdp-sdk (pulled in transitively by @wagmi/connectors' Base Account / Coinbase Wallet
    // connector, which Ledger doesn't use — see src/lib/wagmi.ts) has an optional x402 payment
    // feature behind dynamic imports of the @x402/* scope, which is intentionally not installed
    // (it's an optional peer dependency, not a bug in package.json). Webpack still tries to resolve
    // these statically for code-splitting and fails the whole build over a feature this app never
    // uses. Aliasing them to false tells webpack to provide an empty module instead.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm": false,
      "@x402/svm/exact/client": false,
      // pino-pretty is an optional dev-only pretty-printer for the `pino` logger WalletConnect's
      // provider uses; not installing it is normal (it's meant for a Node backend, not a browser
      // bundle) but webpack still warns about the unresolved dynamic require.
      "pino-pretty": false,
      // @metamask/sdk (pulled in by @wagmi/connectors' MetaMask connector) optionally supports React
      // Native, behind an import of @react-native-async-storage/async-storage — irrelevant and not
      // installed in a web-only app, same class of noise as the two aliases above.
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
