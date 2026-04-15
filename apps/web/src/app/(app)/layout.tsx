import type { ReactNode } from "react";
import { PluginBootstrap } from "@/components/PluginBootstrap";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeProvider } from "@/components/ThemeProvider";
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <div className="flex flex-col min-h-screen">
        <VerifyEmailBanner />
        <PluginBootstrap />
        <CommandPalette />
        <div className="flex-1">{children}</div>
        <StatusBar />
      </div>
    </ThemeProvider>
  );
}
