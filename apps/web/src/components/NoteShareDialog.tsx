"use client";
import { useEffect, useState } from "react";

interface ShareRow {
  id: string;
  userId: string;
  role: "VIEW" | "EDIT";
  user: { email: string; name: string | null };
}
interface LinkRow {
  id: string;
  slug: string;
  expiresAt: string | null;
  createdAt: string;
}

interface Props {
  noteId: string;
  canToggleVisibility: boolean;
  initialVisibility: "WORKSPACE" | "PRIVATE";
  onClose: () => void;
}

export function NoteShareDialog({ noteId, canToggleVisibility, initialVisibility, onClose }: Props) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"VIEW" | "EDIT">("VIEW");
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/notes/${noteId}/shares`);
    if (res.ok) {
      const body = await res.json();
      setShares(body.shares);
      setLinks(body.links);
    }
  }
  useEffect(() => {
    refresh();
  }, [noteId]); // refresh is defined in the component body and only reads noteId

  async function addShare() {
    setStatus(null);
    const res = await fetch(`/api/notes/${noteId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (res.status === 404) {
      const body = await res.json();
      setStatus(body.reason === "user_not_found" ? "No account with that email." : "Not found.");
      return;
    }
    if (!res.ok) {
      setStatus("Failed to share.");
      return;
    }
    setEmail("");
    await refresh();
  }

  async function removeShare(userId: string) {
    await fetch(`/api/notes/${noteId}/shares/${userId}`, { method: "DELETE" });
    await refresh();
  }

  async function patchRole(userId: string, newRole: "VIEW" | "EDIT") {
    await fetch(`/api/notes/${noteId}/shares/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    await refresh();
  }

  async function flipVisibility(next: "WORKSPACE" | "PRIVATE") {
    const res = await fetch(`/api/notes/${noteId}/visibility`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    if (res.ok) setVisibility(next);
  }

  async function createLink() {
    await fetch(`/api/notes/${noteId}/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    await refresh();
  }
  async function revokeLink(linkId: string) {
    await fetch(`/api/notes/${noteId}/links/${linkId}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div role="dialog" aria-label="Share note" className="fixed inset-0 z-50 flex items-start justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md mx-4 my-8 rounded bg-white dark:bg-slate-900 p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Share note</h2>
          <button onClick={onClose} aria-label="Close" className="text-sm underline">Close</button>
        </div>

        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">People with access</h3>
        <ul className="mb-3 space-y-1">
          {shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 truncate">{s.user.name ?? s.user.email}</span>
              <select
                className="rounded border px-1 py-0.5 text-sm"
                value={s.role}
                onChange={(e) => patchRole(s.userId, e.target.value as "VIEW" | "EDIT")}
              >
                <option value="VIEW">View</option>
                <option value="EDIT">Edit</option>
              </select>
              <button className="text-sm underline" onClick={() => removeShare(s.userId)}>Remove</button>
            </li>
          ))}
        </ul>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded border px-2 py-1 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "VIEW" | "EDIT")}
            className="rounded border px-1 py-1 text-sm"
          >
            <option value="VIEW">View</option>
            <option value="EDIT">Edit</option>
          </select>
          <button
            onClick={addShare}
            disabled={!email}
            className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Share
          </button>
        </div>
        {status && <p role="status" className="mb-2 text-sm">{status}</p>}

        {canToggleVisibility && (
          <fieldset className="mb-3">
            <legend className="text-xs font-semibold uppercase text-slate-500">Visibility</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "WORKSPACE"} onChange={() => flipVisibility("WORKSPACE")} />
              Everyone in workspace
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={visibility === "PRIVATE"} onChange={() => flipVisibility("PRIVATE")} />
              Only people I share with
            </label>
          </fieldset>
        )}

        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Public link</h3>
        {links.length === 0 ? (
          <button onClick={createLink} className="rounded border px-3 py-1 text-sm">Create public link</button>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <code className="flex-1 break-all text-xs">
                  {`${typeof window !== "undefined" ? window.location.origin : ""}/public/n/${l.slug}`}
                </code>
                <div className="flex gap-2">
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/public/n/${l.slug}`)}
                  >
                    Copy
                  </button>
                  <button className="rounded border px-2 py-1 text-xs" onClick={() => revokeLink(l.id)}>
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
