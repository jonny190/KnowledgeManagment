import type { ReactNode } from "react";
import { PluginBootstrap } from "@/components/PluginBootstrap";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeProvider } from "@/components/ThemeProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <div className="flex flex-col min-h-screen">
        <PluginBootstrap />
        <CommandPalette />
        <div className="flex-1">{children}</div>
        <StatusBar />
      </div>
    </ThemeProvider>
  );
}
