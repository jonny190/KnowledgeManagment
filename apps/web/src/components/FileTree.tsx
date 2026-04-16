"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileTreeItem, TreeNode, TreeItem } from "./FileTreeItem";
import { MovePicker } from "./MovePicker";

type PendingMove =
  | { kind: "folder"; id: string; label: string }
  | { kind: "note"; id: string; label: string }
  | null;

export function FileTree({ vaultId }: { vaultId: string }) {
  const router = useRouter();
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [items, setItems] = useState<TreeItem[]>([]);
  const [pendingMove, setPendingMove] = useState<PendingMove>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/vaults/${vaultId}/tree`);
    const data = await res.json();
    setRoot(data.root);
    if (Array.isArray(data.items)) {
      setItems(data.items as TreeItem[]);
    } else if (Array.isArray(data.notes)) {
      setItems(
        (data.notes as Array<{ id: string; title: string; folderId: string | null }>).map(
          (n) => ({ id: n.id, title: n.title, kind: "note" as const, folderId: n.folderId }),
        ),
      );
    }
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
    if (data.note) router.push(`/vault/${vaultId}/note/${data.note.id}`);
  }

  async function createDrawio(folderId: string) {
    const title = window.prompt("Diagram title?", "Untitled diagram");
    if (!title) return;
    const res = await fetch("/api/diagrams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, folderId, kind: "DRAWIO", title }),
    });
    const data = await res.json();
    await reload();
    if (data.id) router.push(`/vault/${vaultId}/diagram/${data.id}`);
  }

  async function createBpmn(folderId: string) {
    const title = window.prompt("Process title?", "Untitled process");
    if (!title) return;
    const res = await fetch("/api/diagrams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vaultId, folderId, kind: "BPMN", title }),
    });
    const data = await res.json();
    await reload();
    if (data.id) router.push(`/vault/${vaultId}/diagram/${data.id}`);
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

  function requestMove(kind: "folder" | "note", id: string, label: string) {
    setPendingMove({ kind, id, label });
  }

  async function confirmMove(targetFolderId: string) {
    if (!pendingMove) return;
    await dropInto(targetFolderId, pendingMove.kind, pendingMove.id);
    setPendingMove(null);
  }

  if (!root) return <div>Loading tree...</div>;
  return (
    <>
      <ul>
        <FileTreeItem
          vaultId={vaultId}
          node={root}
          items={items}
          onCreateFolder={createFolder}
          onCreateNote={createNote}
          onCreateDrawio={createDrawio}
          onCreateBpmn={createBpmn}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onDropInto={dropInto}
          onRequestMove={requestMove}
        />
      </ul>
      <MovePicker
        open={pendingMove !== null}
        vaultId={vaultId}
        itemLabel={pendingMove?.label ?? ""}
        onCancel={() => setPendingMove(null)}
        onPick={confirmMove}
      />
    </>
  );
}
