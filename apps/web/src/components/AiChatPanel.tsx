"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { openSse, type ParsedSseEvent } from "@/lib/sse";
import { AiMessageView, type AiMessageBlock } from "./AiMessageView";

export interface AiChatPanelProps {
  vaultId: string;
  noteId: string;
  active: boolean;
  onApplyAtCursor?: (text: string) => void;
  registerCommandRunner?: (
    fn: (cmd: { command: string; selection: string; language?: string }) => void,
  ) => void;
}

interface PersistedMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "TOOL" | "SYSTEM";
  content: AiMessageBlock[];
}

export function AiChatPanel(props: AiChatPanelProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PersistedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 0 });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingBlocksRef = useRef<AiMessageBlock[]>([]);

  useEffect(() => {
    if (!props.active) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultId: props.vaultId, noteId: props.noteId }),
      });
      const json = await res.json();
      if (cancelled) return;
      setConversationId(json.id);
      setMessages(
        (json.messages ?? []).map((m: PersistedMessage) => ({
          id: m.id,
          role: m.role,
          content: Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content) }],
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [props.active, props.vaultId, props.noteId]);

  const handleEvent = useCallback((ev: ParsedSseEvent) => {
    const data = ev.data;
    if (data.type === "text") {
      const last = streamingBlocksRef.current.at(-1);
      if (last && last.type === "text") {
        last.text = (last.text ?? "") + data.delta;
      } else {
        streamingBlocksRef.current.push({ type: "text", text: data.delta });
      }
      setMessages((prev) => [...prev]);
    } else if (data.type === "tool_use") {
      streamingBlocksRef.current.push({
        type: "tool_use",
        id: data.id,
        name: data.name,
        input: data.args,
      });
      setMessages((prev) => [...prev]);
    } else if (data.type === "tool_result") {
      streamingBlocksRef.current.push({
        type: "tool_result",
        id: data.id,
        ok: data.ok,
        result: data.result,
        error: data.error,
      });
      setMessages((prev) => [...prev]);
    } else if (data.type === "tool_result_undoable") {
      streamingBlocksRef.current.push({
        type: "undoable",
        callId: data.callId,
        summary: data.summary,
        undo: data.undo,
      });
      setMessages((prev) => [...prev]);
    } else if (data.type === "usage") {
      setUsage((u) => ({ used: u.used + data.inputTokens + data.outputTokens, limit: u.limit }));
    } else if (data.type === "error") {
      setError(data.message);
    }
  }, []);

  const flushStreamingMessage = useCallback(() => {
    if (streamingBlocksRef.current.length === 0) return;
    const blocks = streamingBlocksRef.current;
    streamingBlocksRef.current = [];
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "ASSISTANT", content: blocks },
    ]);
  }, []);

  const send = useCallback(
    async (payload: { url: string; body: unknown; localUserText: string }) => {
      if (!conversationId) return;
      setError(null);
      setStreaming(true);
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-u`,
          role: "USER",
          content: [{ type: "text", text: payload.localUserText }],
        },
      ]);
      const ctl = new AbortController();
      abortRef.current = ctl;
      streamingBlocksRef.current = [];
      try {
        await openSse({
          url: payload.url,
          body: payload.body,
          signal: ctl.signal,
          onEvent: handleEvent,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        flushStreamingMessage();
        setStreaming(false);
      }
    },
    [conversationId, handleEvent, flushStreamingMessage],
  );

  useEffect(() => {
    if (!props.registerCommandRunner) return;
    props.registerCommandRunner(({ command, selection, language }) => {
      void send({
        url: "/api/ai/command",
        body: { conversationId, command, selection, language },
        localUserText: `/${command} on selection`,
      });
    });
  }, [props, conversationId, send]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 p-2 text-sm">
        <span>AI chat</span>
        <span className="text-xs text-slate-600">
          {usage.used} tokens used today
        </span>
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {messages.map((m) => (
          <AiMessageView
            key={m.id}
            role={m.role}
            blocks={m.content}
            onApply={props.onApplyAtCursor}
          />
        ))}
        {streaming && streamingBlocksRef.current.length > 0 ? (
          <AiMessageView
            role="ASSISTANT"
            blocks={streamingBlocksRef.current}
            onApply={props.onApplyAtCursor}
          />
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
      <form
        className="border-t border-slate-200 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim() || streaming) return;
          const text = draft;
          setDraft("");
          void send({
            url: "/api/ai/chat",
            body: { conversationId, message: text },
            localUserText: text,
          });
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded border border-slate-300 p-1 text-sm"
          placeholder="Ask the AI about this note..."
        />
        <button
          type="submit"
          disabled={streaming}
          className="mt-1 rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
