"use client";
import { useEffect, useState } from "react";

export default function PluginsSettingsPage() {
  const [list, setList] = useState<{ id: string; url: string; enabled: boolean }[]>([]);
  const [url, setUrl] = useState("");

  async function reload() {
    const r = await fetch("/api/plugins");
    const { plugins } = await r.json();
    setList(plugins ?? []);
  }
  useEffect(() => {
    reload();
  }, []);

  async function add() {
    if (!url.trim()) return;
    await fetch("/api/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setUrl("");
    reload();
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/plugins/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    reload();
  }

  async function remove(id: string) {
    await fetch(`/api/plugins/${id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Plugins</h1>
      <p className="mt-2 text-sm text-[var(--muted,#6b7280)]">
        Add plugin URLs to load at startup. Only URLs from allow-listed origins are
        accepted.
      </p>
      <div className="flex gap-2 mt-4">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/plugins/name.js"
          className="flex-1 rounded border px-2 py-1 bg-[var(--bg,#fff)]"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} className="rounded border px-3 py-1">
          Add
        </button>
      </div>
      <ul className="mt-6 space-y-2">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={p.enabled}
              onChange={(e) => toggle(p.id, e.target.checked)}
            />
            <span className="flex-1 truncate text-sm">{p.url}</span>
            <button
              onClick={() => remove(p.id)}
              className="text-sm text-[var(--muted,#6b7280)] hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className="text-sm text-[var(--muted,#6b7280)]">No plugins installed.</li>
        )}
      </ul>
    </div>
  );
}
