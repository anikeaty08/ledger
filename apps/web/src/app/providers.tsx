"use client";

import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "@/lib/wagmi";
import { useTheme } from "@/lib/theme";

const shared = { borderRadius: "small", fontStack: "system" } as const;
const font = { body: "var(--font-sans), Inter, system-ui, sans-serif" };

const dark = darkTheme({ ...shared, accentColor: "#0A6CF0", accentColorForeground: "#FFFFFF" });
const light = lightTheme({ ...shared, accentColor: "#0052FF", accentColorForeground: "#FFFFFF" });

const rainbowThemes = {
  dark: {
    ...dark,
    colors: {
      ...dark.colors,
      modalBackground: "#050B12",
      modalBorder: "#172536",
      connectButtonBackground: "#050B12",
      connectButtonInnerBackground: "#09111B",
    },
    fonts: font,
  },
  light: { ...light, colors: { ...light.colors, modalBorder: "#D5DEEA" }, fonts: font },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [theme] = useTheme();

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowThemes[theme]} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
