"use client";
import { useState, useEffect } from "react";
import { NoteShareDialog } from "./NoteShareDialog";
import { NoteShareBadge } from "./NoteShareBadge";

interface Props {
  noteId: string;
  visibility: "WORKSPACE" | "PRIVATE";
  vaultOwnerType: "USER" | "WORKSPACE";
}

export function NoteShareHeader({ noteId, visibility, vaultOwnerType }: Props) {
  const [open, setOpen] = useState(false);
  const [shareCount, setShareCount] = useState(0);
  const [hasActiveLink, setHasActiveLink] = useState(false);

  useEffect(() => {
    fetch(`/api/notes/${noteId}/shares`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body) return;
        setShareCount(body.shares.length);
        setHasActiveLink(body.links.length > 0);
      })
      .catch(() => undefined);
  }, [noteId]);

  return (
    <div className="note-share-header">
      <NoteShareBadge shareCount={shareCount} hasActiveLink={hasActiveLink} />
      <button onClick={() => setOpen(true)}>Share</button>
      {open && (
        <NoteShareDialog
          noteId={noteId}
          canToggleVisibility={vaultOwnerType === "WORKSPACE"}
          initialVisibility={visibility}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
