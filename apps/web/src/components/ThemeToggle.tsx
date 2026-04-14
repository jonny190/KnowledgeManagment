"use client";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return (
    <button onClick={toggle} className="rounded border px-2 py-1 text-sm">
      {mode === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
