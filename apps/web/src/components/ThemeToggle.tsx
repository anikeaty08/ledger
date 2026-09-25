"use client";

import { useTheme } from "@/lib/theme";
import { Icon } from "./Icon";

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      className="btn inline-flex h-10 w-10 items-center justify-center rounded border border-rule-strong bg-paper-dim text-ink hover:border-accent"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
    </button>
  );
}
