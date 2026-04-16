"use client";
import { useEffect, useState } from "react";

export interface MovePickerFolder {
  id: string;
  name: string;
  path: string;
}

export interface MovePickerProps {
  open: boolean;
  vaultId: string;
  itemLabel: string;
  onCancel: () => void;
  onPick: (targetFolderId: string) => void;
}

interface TreeNode {
  id: string;
  name: string;
  path: string;
  children: TreeNode[];
}

function flatten(node: TreeNode, depth: number, acc: MovePickerFolder[]) {
  acc.push({ id: node.id, name: node.name || "(root)", path: node.path });
  for (const c of node.children) flatten(c, depth + 1, acc);
}

export function MovePicker({ open, vaultId, itemLabel, onCancel, onPick }: MovePickerProps) {
  const [folders, setFolders] = useState<MovePickerFolder[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/vaults/${vaultId}/tree`)
      .then((r) => r.json())
      .then((body: { root: TreeNode }) => {
        if (cancelled || !body.root) return;
        const acc: MovePickerFolder[] = [];
        flatten(body.root, 0, acc);
        setFolders(acc);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, vaultId]);

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Move" className="fixed inset-0 z-50 flex items-start justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-md mx-4 my-8 rounded bg-white dark:bg-slate-900 shadow-xl">
        <header className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-medium">Move {itemLabel}</h2>
          <button type="button" onClick={onCancel} className="text-sm underline">Cancel</button>
        </header>
        <ul className="max-h-[60vh] overflow-auto p-2">
          {folders.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onPick(f.id)}
                className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className="font-medium">{f.name}</span>
                {f.path ? <span className="ml-2 text-xs text-slate-500">{f.path}</span> : null}
              </button>
            </li>
          ))}
          {folders.length === 0 ? (
            <li className="p-3 text-sm text-slate-500">No folders.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
