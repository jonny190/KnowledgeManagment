"use client";
import React, { useSyncExternalStore } from "react";
import { pluginRegistry } from "@/lib/plugins/registry";

function subscribe(cb: () => void) {
  return pluginRegistry.subscribe(cb);
}
function getRevision() {
  return pluginRegistry.revision;
}

export function StatusBar() {
  // Re-render whenever the plugin registry notifies a change (registrations,
  // disposals, or emitted note events). Returning a scalar revision keeps
  // useSyncExternalStore's Object.is comparison stable otherwise.
  useSyncExternalStore(subscribe, getRevision, getRevision);
  const items = [...pluginRegistry.statusItems.values()];
  return (
    <div className="h-6 border-t border-[var(--border,#e5e7eb)] text-xs flex gap-4 px-3 items-center text-[var(--muted,#6b7280)]">
      {items.map(({ item }, i) => (
        <span key={i}>{item.render() as React.ReactNode}</span>
      ))}
    </div>
  );
}
