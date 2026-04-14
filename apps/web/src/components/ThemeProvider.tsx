"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Mode = "light" | "dark";
interface Ctx {
  mode: Mode;
  toggle: () => void;
}

const ThemeCtx = createContext<Ctx>({ mode: "light", toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as Mode) ?? "light";
    setMode(current);
  }, []);

  function toggle() {
    const next: Mode = mode === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("km:theme", next);
    setMode(next);
    fetch("/api/me/theme", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ themePreference: next }),
    }).catch(() => {});
  }

  return <ThemeCtx.Provider value={{ mode, toggle }}>{children}</ThemeCtx.Provider>;
}
