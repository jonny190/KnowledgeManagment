"use client";
import { useEffect, useRef, type RefObject } from "react";

export interface FileTreeItemMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  kind: "folder" | "note" | "drawio" | "bpmn";
  onRename?: () => void;
  onDelete?: () => void;
  onMove?: () => void;
  onNewNote?: () => void;
  onNewFolder?: () => void;
  onNewDrawio?: () => void;
  onNewBpmn?: () => void;
}

export function FileTreeItemMenu(p: FileTreeItemMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!p.open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t) && p.anchorRef.current && !p.anchorRef.current.contains(t)) {
        p.onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [p.open, p.onClose, p.anchorRef]);

  if (!p.open) return null;

  const items: Array<{ label: string; handler?: () => void }> = [];
  if (p.kind === "folder") {
    items.push(
      { label: "New note", handler: p.onNewNote },
      { label: "New folder", handler: p.onNewFolder },
      { label: "New diagram", handler: p.onNewDrawio },
      { label: "New process (BPMN)", handler: p.onNewBpmn },
      { label: "Rename", handler: p.onRename },
      { label: "Move", handler: p.onMove },
      { label: "Delete", handler: p.onDelete },
    );
  } else {
    items.push(
      { label: "Rename", handler: p.onRename },
      { label: "Move", handler: p.onMove },
      { label: "Delete", handler: p.onDelete },
    );
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded border bg-white dark:bg-slate-900 shadow-lg"
    >
      <ul className="py-1">
        {items
          .filter((i) => typeof i.handler === "function")
          .map((i) => (
            <li key={i.label}>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  i.handler?.();
                  p.onClose();
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {i.label}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
