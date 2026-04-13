"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  noteId: string;
  initialTitle: string;
  initialContent: string;
}

export function NoteEditor({ noteId, initialTitle, initialContent }: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save(next: { title?: string; content?: string }) {
    setStatus("saving");
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    setStatus(res.ok ? "saved" : "error");
  }

  function scheduleSave(next: { title?: string; content?: string }) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 1500);
  }

  useEffect(() => {
    const handler = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        save({ title, content });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [title, content]);

  return (
    <div className="flex flex-col h-full p-4 gap-2">
      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          scheduleSave({ title: e.target.value, content });
        }}
        onBlur={() => save({ title, content })}
        className="text-2xl font-semibold border-b pb-1"
      />
      <textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          scheduleSave({ title, content: e.target.value });
        }}
        onBlur={() => save({ title, content })}
        className="flex-1 font-mono border rounded p-2"
      />
      <div className="text-xs text-gray-500">Status: {status}</div>
    </div>
  );
}
