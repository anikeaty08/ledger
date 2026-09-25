"use client";

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "ledger-theme";
const EVENT = "ledger-theme-change";

function read(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);
  const set = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  };
  return [theme, set];
}

/** Runs before first paint (inlined in <head>) so a light-mode visitor never sees a dark flash. */
export const themeBootScript = `try{document.documentElement.dataset.theme=localStorage.getItem("${STORAGE_KEY}")==="light"?"light":"dark"}catch(e){}`;
