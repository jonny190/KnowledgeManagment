"use client";

import { useCallback, useEffect, useState } from "react";
import { FileTreeItem, TreeNode } from "./FileTreeItem";

export function FileTree({ vaultId }: { vaultId: string }) {
  const [root, setRoot] = useState<TreeNode | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/vaults/${vaultId}/tree`);
    const data = await res.json();
    setRoot(data.root);
  }, [vaultId]);

  useEffect(() => { reload(); }, [reload]);

  async function createFolder(parentId: string) {
    const name = window.prompt("Folder name?");
    if (!name) return;
    await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, parentId, name }),
    });
    await reload();
  }

  async function createNote(folderId: string) {
    const title = window.prompt("Note title?");
    if (!title) return;
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, folderId, title }),
    });
    const data = await res.json();
    await reload();
    if (data.note) window.location.href = `/vault/${vaultId}/note/${data.note.id}`;
  }

  async function renameFolder(id: string, current: string) {
    const name = window.prompt("Rename folder", current);
    if (!name || name === current) return;
    await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await reload();
  }

  async function deleteFolder(id: string) {
    if (!window.confirm("Delete this folder and all contents?")) return;
    await fetch(`/api/folders/${id}`, { method: "DELETE" });
    await reload();
  }

  async function dropInto(targetFolderId: string, kind: "folder" | "note", id: string) {
    if (kind === "folder") {
      await fetch(`/api/folders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: targetFolderId }),
      });
    } else {
      await fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
    }
    await reload();
  }

  if (!root) return <div>Loading tree...</div>;
  return (
    <ul>
      <FileTreeItem
        vaultId={vaultId}
        node={root}
        onCreateFolder={createFolder}
        onCreateNote={createNote}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onDropInto={dropInto}
      />
    </ul>
  );
}
