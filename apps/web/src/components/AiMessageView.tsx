"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { AiToolCallCard } from "./AiToolCallCard";
import { ChatUndoStrip } from "./ai/ChatUndoStrip";

export interface AiMessageBlock {
  type: "text" | "tool_use" | "tool_result" | "undoable";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string;
  callId?: string;
  summary?: string;
  undo?: { kind: "create_note" | "create_folder"; id: string } | null;
}

export interface AiMessageViewProps {
  role: "USER" | "ASSISTANT" | "TOOL" | "SYSTEM";
  blocks: AiMessageBlock[];
  onApply?: (text: string) => void;
}

export function AiMessageView(props: AiMessageViewProps) {
  const isAssistant = props.role === "ASSISTANT";
  return (
    <div className={`mb-3 rounded p-2 ${isAssistant ? "bg-white" : "bg-blue-50"}`}>
      {props.blocks.map((b, i) => {
        if (b.type === "text" && b.text !== undefined) {
          return (
            <div key={i}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {b.text}
              </ReactMarkdown>
              {isAssistant && props.onApply ? (
                <button
                  type="button"
                  onClick={() => props.onApply!(b.text!)}
                  className="mt-1 text-xs underline"
                >
                  Apply at cursor
                </button>
              ) : null}
            </div>
          );
        }
        if (b.type === "tool_use") {
          return <AiToolCallCard key={i} name={b.name ?? "?"} args={b.input} />;
        }
        if (b.type === "tool_result") {
          return (
            <AiToolCallCard
              key={i}
              name="result"
              args={null}
              result={b.result}
              ok={b.ok}
              error={b.error}
            />
          );
        }
        if (b.type === "undoable" && b.summary !== undefined) {
          return (
            <ChatUndoStrip
              key={i}
              summary={b.summary}
              undo={b.undo ?? null}
            />
          );
        }
        return null;
      })}
    </div>
  );
}
