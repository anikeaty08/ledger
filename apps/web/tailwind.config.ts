import type { Config } from "tailwindcss";

// Design tokens from the Ledger visual system: ruled ledger paper, not glass or gradient cards.
// See docs/SYSTEM_DESIGN.md §17 and the design-plan conversation for the reasoning behind each token.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#EDF2EA", // traditional ledger-paper green, desaturated
          dim: "#E2E9DE",
        },
        ink: {
          DEFAULT: "#221F1A", // warm near-black, like iron-gall ink
          soft: "#5B5A54",
        },
        rule: {
          DEFAULT: "#A8B5A0", // structural line color — quiet, not decorative
          soft: "#D3DBCE",
        },
        red: {
          DEFAULT: "#8B2E23", // oxblood — "in the red": overdue/defaulted states, the one accent
          soft: "#F3E4E1",
        },
        gold: {
          DEFAULT: "#B8763E", // muted antique gold — BTC-denominated amounts only
          soft: "#F1E6D8",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "Public Sans", "Segoe UI", "Arial", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        DEFAULT: "6px", // buttons and interactive controls only — data rows stay square
      },
      maxWidth: {
        prose: "72ch",
      },
    },
  },
  plugins: [],
};

export default config;
