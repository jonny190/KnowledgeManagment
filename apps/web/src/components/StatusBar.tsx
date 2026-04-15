"use client";
import React, { useSyncExternalStore } from "react";
import { pluginRegistry } from "@/lib/plugins/registry";

let cachedSize = -1;
let cachedSnapshot: ReturnType<typeof buildSnapshot> = [];

function buildSnapshot() {
  return [...pluginRegistry.statusItems.values()];
}

function snapshot() {
  const size = pluginRegistry.statusItems.size;
  if (size !== cachedSize) {
    cachedSize = size;
    cachedSnapshot = buildSnapshot();
  }
  return cachedSnapshot;
}

function subscribe(cb: () => void) {
  const id = setInterval(() => {
    if (pluginRegistry.statusItems.size !== cachedSize) cb();
  }, 500);
  return () => clearInterval(id);
}

export function StatusBar() {
  const items = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <div className="h-6 border-t border-[var(--border,#e5e7eb)] text-xs flex gap-4 px-3 items-center text-[var(--muted,#6b7280)]">
      {items.map(({ item }, i) => (
        <span key={i}>{item.render() as React.ReactNode}</span>
      ))}
    </div>
  );
}
