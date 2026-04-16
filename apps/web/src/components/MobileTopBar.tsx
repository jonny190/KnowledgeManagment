"use client";
import type { ReactNode } from "react";

export interface MobileTopBarButton {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export interface MobileTopBarProps {
  title: string;
  buttons: MobileTopBarButton[];
}

export function MobileTopBar({ title, buttons }: MobileTopBarProps) {
  return (
    <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-white dark:bg-slate-900 p-2">
      <div className="w-24 shrink-0" />
      <h1 className="flex-1 truncate text-center text-sm font-medium">{title}</h1>
      <div className="flex w-24 shrink-0 justify-end gap-1">
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={b.onClick}
            aria-label={b.label}
            className="rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {b.icon ?? b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
