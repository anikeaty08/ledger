import type { Config } from "tailwindcss";

// Every color is a CSS variable (RGB channels) set per theme in globals.css, so opacity modifiers like
// `bg-paper/75` keep working and the light/dark toggle is one attribute on <html>.
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: v("bg"), dim: v("surface"), raised: v("surface-soft") },
        ink: { DEFAULT: v("text"), soft: v("muted"), faint: v("faint") },
        rule: { DEFAULT: v("border"), soft: v("border-soft"), strong: v("border-strong") },
        accent: { DEFAULT: v("accent"), strong: v("accent-strong"), soft: v("accent-soft") },
        red: { DEFAULT: v("danger"), soft: v("danger-soft") },
        gold: { DEFAULT: v("gold"), soft: v("gold-soft") },
        ok: { DEFAULT: v("success") },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "Segoe UI", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        DEFAULT: "9px",
        lg: "16px",
      },
      maxWidth: {
        prose: "72ch",
        site: "92rem",
      },
    },
  },
  plugins: [],
};

export default config;
