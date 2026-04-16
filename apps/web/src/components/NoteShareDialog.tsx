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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

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
    <div role="dialog" aria-label="Share note" className="share-dialog">
      <button onClick={onClose} aria-label="Close">Close</button>

      <h2>People with access</h2>
      <ul>
        {shares.map((s) => (
          <li key={s.id}>
            <span>{s.user.name ?? s.user.email}</span>
            <select value={s.role} onChange={(e) => patchRole(s.userId, e.target.value as "VIEW" | "EDIT")}>
              <option value="VIEW">View</option>
              <option value="EDIT">Edit</option>
            </select>
            <button onClick={() => removeShare(s.userId)}>Remove</button>
          </li>
        ))}
      </ul>

      <div>
        <input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value as "VIEW" | "EDIT")}>
          <option value="VIEW">View</option>
          <option value="EDIT">Edit</option>
        </select>
        <button onClick={addShare} disabled={!email}>Share</button>
        {status && <p role="status">{status}</p>}
      </div>

      {canToggleVisibility && (
        <fieldset>
          <legend>Visibility</legend>
          <label>
            <input type="radio" checked={visibility === "WORKSPACE"} onChange={() => flipVisibility("WORKSPACE")} />
            Everyone in workspace
          </label>
          <label>
            <input type="radio" checked={visibility === "PRIVATE"} onChange={() => flipVisibility("PRIVATE")} />
            Only people I share with
          </label>
        </fieldset>
      )}

      <h3>Public link</h3>
      {links.length === 0 ? (
        <button onClick={createLink}>Create public link</button>
      ) : (
        <ul>
          {links.map((l) => (
            <li key={l.id}>
              <code>{`${typeof window !== "undefined" ? window.location.origin : ""}/public/n/${l.slug}`}</code>
              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/public/n/${l.slug}`)}>
                Copy
              </button>
              <button onClick={() => revokeLink(l.id)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
