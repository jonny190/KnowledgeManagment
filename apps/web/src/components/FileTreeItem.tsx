"use client";

import Link from "next/link";
import { useState } from "react";

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  children: TreeNode[];
  notes: Array<{ id: string; title: string; slug: string }>;
}

interface Props {
  vaultId: string;
  node: TreeNode;
  onCreateFolder: (parentId: string) => void;
  onCreateNote: (folderId: string) => void;
  onRenameFolder: (id: string, currentName: string) => void;
  onDeleteFolder: (id: string) => void;
  onDropInto: (targetFolderId: string, kind: "folder" | "note", id: string) => void;
}

export function FileTreeItem(p: Props) {
  const [open, setOpen] = useState(true);

  return (
    <li
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const kind = e.dataTransfer.getData("kind") as "folder" | "note";
        const id = e.dataTransfer.getData("id");
        if (id) p.onDropInto(p.node.id, kind, id);
      }}
    >
      <div
        className="flex items-center gap-1"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("kind", "folder");
          e.dataTransfer.setData("id", p.node.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const choice = window.prompt("Action: new-folder | new-note | rename | delete");
          if (choice === "new-folder") p.onCreateFolder(p.node.id);
          else if (choice === "new-note") p.onCreateNote(p.node.id);
          else if (choice === "rename") p.onRenameFolder(p.node.id, p.node.name);
          else if (choice === "delete") p.onDeleteFolder(p.node.id);
        }}
      >
        <button onClick={() => setOpen(!open)} className="w-4">{open ? "v" : ">"}</button>
        <span>{p.node.name === "" ? "(root)" : p.node.name}</span>
      </div>
      {open && (
        <ul className="pl-4">
          {p.node.children.map((c) => (
            <FileTreeItem key={c.id} {...p} node={c} />
          ))}
          {p.node.notes.map((n) => (
            <li
              key={n.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("kind", "note");
                e.dataTransfer.setData("id", n.id);
              }}
            >
              <Link href={`/vault/${p.vaultId}/note/${n.id}`}>{n.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
