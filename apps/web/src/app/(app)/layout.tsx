import type { ReactNode } from "react";
import { PluginBootstrap } from "@/components/PluginBootstrap";
import { StatusBar } from "@/components/StatusBar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      <PluginBootstrap />
      <div className="flex-1">{children}</div>
      <StatusBar />
    </div>
  );
}
