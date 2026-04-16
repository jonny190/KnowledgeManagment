"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  title?: string;
  children: ReactNode;
}

export function Drawer({ open, onClose, side, title, children }: DrawerProps) {
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  // Close on route change (not on initial render).
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      if (open) onClose();
    }
  }, [pathname]); // onClose intentionally excluded to avoid infinite loop

  // Escape key dismiss.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Body scroll lock.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const sideClass =
    side === "left"
      ? "left-0 top-0 bottom-0 border-r"
      : "right-0 top-0 bottom-0 border-l";

  return (
    <div className="fixed inset-0 z-40">
      <div
        data-testid="drawer-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={title ?? "Drawer"}
        className={`absolute ${sideClass} w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-xl flex flex-col`}
      >
        {title ? (
          <header className="flex items-center justify-between border-b p-3">
            <h2 className="text-sm font-medium">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="text-sm underline"
            >
              Close
            </button>
          </header>
        ) : null}
        <div className="flex-1 overflow-auto">{children}</div>
      </aside>
    </div>
  );
}
