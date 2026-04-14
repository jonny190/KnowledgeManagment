"use client";
import { useSyncExternalStore } from "react";
import { pluginRegistry } from "@/lib/plugins/registry";

function subscribe(cb: () => void) {
  const id = setInterval(cb, 500);
  return () => clearInterval(id);
}
function snapshot() {
  return [...pluginRegistry.statusItems.values()];
}

export function StatusBar() {
  const items = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <div className="h-6 border-t border-[var(--border,#e5e7eb)] text-xs flex gap-4 px-3 items-center text-[var(--muted,#6b7280)]">
      {items.map(({ item }, i) => (
        <span key={i}>{item.render()}</span>
      ))}
    </div>
  );
}
