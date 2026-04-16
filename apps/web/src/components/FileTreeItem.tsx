"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FileTreeItemMenu } from "./FileTreeItemMenu";
import { usePointerType } from "@/hooks/usePointerType";

export interface TreeItem {
  id: string;
  title: string;
  kind: "note" | "drawio" | "bpmn";
  folderId: string | null;
}

export interface TreeNode {
  id: string;
  name: string;
  path: string;
  children: TreeNode[];
  notes: Array<{ id: string; title: string; slug: string }>;
}

function itemIcon(kind: "note" | "drawio" | "bpmn"): string {
  if (kind === "drawio") return "[D]";
  if (kind === "bpmn") return "[B]";
  return "[N]";
}

function itemHref(vaultId: string, item: TreeItem): string {
  if (item.kind === "note") return `/vault/${vaultId}/note/${item.id}`;
  return `/vault/${vaultId}/diagram/${item.id}`;
}

interface Props {
  vaultId: string;
  node: TreeNode;
  items?: TreeItem[];
  onCreateFolder: (parentId: string) => void;
  onCreateNote: (folderId: string) => void;
  onCreateDrawio: (folderId: string) => void;
  onCreateBpmn: (folderId: string) => void;
  onRenameFolder: (id: string, currentName: string) => void;
  onDeleteFolder: (id: string) => void;
  onDropInto: (targetFolderId: string, kind: "folder" | "note", id: string) => void;
  onRequestMove: (kind: "folder" | "note", id: string, label: string) => void;
}

function ThreeDotButton({
  alwaysVisible,
  onClick,
  buttonRef,
  label,
}: {
  alwaysVisible: boolean;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  label: string;
}) {
  const baseClass =
    "ml-auto rounded px-1 text-sm leading-none hover:bg-slate-100 dark:hover:bg-slate-800";
  const visibilityClass = alwaysVisible
    ? ""
    : "opacity-0 group-hover:opacity-100 focus-within:opacity-100";
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Actions for ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`${baseClass} ${visibilityClass}`}
    >
      ...
    </button>
  );
}

export function FileTreeItem(p: Props) {
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const pointer = usePointerType();
  const folderBtnRef = useRef<HTMLButtonElement | null>(null);

  const folderItems = (p.items ?? []).filter((item) => item.folderId === p.node.id);

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
        className="group relative flex items-center gap-1"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("kind", "folder");
          e.dataTransfer.setData("id", p.node.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        <button onClick={() => setOpen(!open)} className="w-4">{open ? "v" : ">"}</button>
        <span>{p.node.name === "" ? "(root)" : p.node.name}</span>
        <ThreeDotButton
          alwaysVisible={pointer === "touch"}
          buttonRef={folderBtnRef}
          label={p.node.name || "root"}
          onClick={() => setMenuOpen((v) => !v)}
        />
        <FileTreeItemMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={folderBtnRef}
          kind="folder"
          onNewNote={() => p.onCreateNote(p.node.id)}
          onNewFolder={() => p.onCreateFolder(p.node.id)}
          onNewDrawio={() => p.onCreateDrawio(p.node.id)}
          onNewBpmn={() => p.onCreateBpmn(p.node.id)}
          onRename={() => p.onRenameFolder(p.node.id, p.node.name)}
          onDelete={() => p.onDeleteFolder(p.node.id)}
          onMove={
            p.node.name === ""
              ? undefined
              : () => p.onRequestMove("folder", p.node.id, p.node.name)
          }
        />
      </div>
      {open && (
        <ul className="pl-4">
          {p.node.children.map((c) => (
            <FileTreeItem key={c.id} {...p} node={c} />
          ))}
          {folderItems.length > 0
            ? folderItems.map((item) => (
                <ItemRow
                  key={item.id}
                  vaultId={p.vaultId}
                  item={item}
                  onRequestMove={p.onRequestMove}
                  pointer={pointer}
                />
              ))
            : p.node.notes.map((n) => (
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

function ItemRow({
  vaultId,
  item,
  onRequestMove,
  pointer,
}: {
  vaultId: string;
  item: TreeItem;
  onRequestMove: (kind: "folder" | "note", id: string, label: string) => void;
  pointer: "touch" | "mouse";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("kind", "note");
        e.dataTransfer.setData("id", item.id);
      }}
      className="group relative flex items-center gap-1"
    >
      <span style={{ marginRight: "0.25rem", fontSize: "0.75rem" }}>
        {itemIcon(item.kind)}
      </span>
      <Link href={itemHref(vaultId, item)} className="flex-1 truncate">{item.title}</Link>
      <ThreeDotButton
        alwaysVisible={pointer === "touch"}
        buttonRef={btnRef}
        label={item.title}
        onClick={() => setMenuOpen((v) => !v)}
      />
      <FileTreeItemMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={btnRef}
        kind={item.kind}
        onMove={() => onRequestMove("note", item.id, item.title)}
      />
    </li>
  );
}
