"use client";
import { useState } from "react";

export interface AiToolCallCardProps {
  name: string;
  args: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
}

export function AiToolCallCard(props: AiToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const status = props.ok === false ? "error" : props.result === undefined ? "running" : "ok";
  return (
    <div className="my-2 rounded border border-slate-300 bg-slate-50 p-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left font-mono"
      >
        <span>
          tool: <strong>{props.name}</strong> [{status}]
        </span>
        <span>{open ? "-" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <pre className="overflow-x-auto rounded bg-white p-2 text-xs">
            {JSON.stringify(props.args, null, 2)}
          </pre>
          {props.result !== undefined ? (
            <pre className="overflow-x-auto rounded bg-white p-2 text-xs">
              {JSON.stringify(props.result, null, 2)}
            </pre>
          ) : null}
          {props.error ? <p className="text-red-700">{props.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
