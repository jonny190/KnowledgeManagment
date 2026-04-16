"use client";
import { useEffect, useState } from "react";
import { undoUrl, type UndoToken } from "./undoUrl";

export interface ChatUndoStripProps {
  summary: string;
  undo: UndoToken | null;
}

export function ChatUndoStrip(props: ChatUndoStripProps) {
  const [remaining, setRemaining] = useState(10);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!props.undo || done) return;
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, props.undo, done]);

  async function onClick() {
    if (!props.undo) return;
    const res = await fetch(undoUrl(props.undo), { method: "DELETE" });
    if (res.ok) setDone(true);
  }

  const showButton = props.undo !== null && remaining > 0 && !done;

  return (
    <div className={`my-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs ${done ? "opacity-60" : ""}`}>
      <span>{props.summary}</span>
      {showButton ? (
        <button
          type="button"
          onClick={onClick}
          className="ml-2 rounded bg-amber-200 px-2 py-0.5 hover:bg-amber-300"
        >
          Undo ({remaining})
        </button>
      ) : null}
      {done ? <span className="ml-2 italic">undone</span> : null}
    </div>
  );
}
