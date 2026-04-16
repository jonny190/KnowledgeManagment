import type { AiSseEvent } from "@km/shared";
import type { AiProvider, AiTool, AiToolContext, AiUsageRecord } from "./types";

export interface RunChatOptions {
  provider: AiProvider;
  tools: AiTool[];
  systemPrompt: string;
  cachedNoteContext?: { hash: string; text: string };
  history: Array<{ role: "user" | "assistant" | "tool"; content: unknown }>;
  ctx: AiToolContext;
  maxToolHops: number;
  signal: AbortSignal;
  emit: (event: AiSseEvent) => void;
}

export async function runChat(opts: RunChatOptions): Promise<AiUsageRecord> {
  const totals = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, model: opts.provider.model };
  let history = [...opts.history];

  for (let hop = 0; hop <= opts.maxToolHops; hop++) {
    const pendingToolCalls: Array<{ id: string; name: string; args: unknown }> = [];

    const usage = await opts.provider.stream(
      {
        systemPrompt: opts.systemPrompt,
        cachedNoteContext: opts.cachedNoteContext,
        history,
        tools: opts.tools,
        signal: opts.signal,
      },
      opts.ctx,
      (event) => {
        if (event.type === "tool_use") {
          pendingToolCalls.push({ id: event.id, name: event.name, args: event.args });
        }
        opts.emit(event);
      },
    );

    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cachedTokens += usage.cachedTokens;

    if (pendingToolCalls.length === 0) {
      return totals;
    }

    if (hop === opts.maxToolHops) {
      throw new Error(`runChat: max tool hops (${opts.maxToolHops}) exceeded`);
    }

    const toolResults: Array<{ id: string; result: unknown; ok: boolean; error?: string }> = [];
    for (const call of pendingToolCalls) {
      const tool = opts.tools.find((t) => t.name === call.name);
      if (!tool) {
        opts.emit({ type: "tool_result", id: call.id, ok: false, error: "unknown_tool" });
        toolResults.push({ id: call.id, ok: false, result: { error: "unknown_tool" }, error: "unknown_tool" });
        continue;
      }
      try {
        const parsed = tool.parse(call.args);
        const result = await tool.execute(parsed, opts.ctx);
        opts.emit({ type: "tool_result", id: call.id, ok: true, result });
        const maybeUndo = (result as { undo?: unknown } | null | undefined)?.undo;
        if (maybeUndo !== undefined) {
          const undoTyped = maybeUndo as
            | { kind: "create_note" | "create_folder"; id: string }
            | null;
          const summary = buildUndoSummary(call.name, result, undoTyped);
          opts.emit({
            type: "tool_result_undoable",
            callId: call.id,
            undo: undoTyped,
            summary,
          });
        }
        toolResults.push({ id: call.id, ok: true, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.emit({ type: "tool_result", id: call.id, ok: false, error: message });
        toolResults.push({ id: call.id, ok: false, result: { error: message }, error: message });
      }
    }

    history = [
      ...history,
      {
        role: "assistant" as const,
        content: pendingToolCalls.map((c) => ({
          type: "tool_use",
          id: c.id,
          name: c.name,
          input: c.args,
        })),
      },
      {
        role: "tool" as const,
        content: toolResults.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: JSON.stringify(r.result),
        })),
      },
    ];
  }

  return totals;
}

function buildUndoSummary(
  toolName: string,
  result: unknown,
  undo: { kind: "create_note" | "create_folder"; id: string } | null,
): string {
  const r = (result ?? {}) as { title?: string; path?: string };
  if (undo === null) {
    const title = r.title ?? "note";
    return `Updated '${title}'. Use Ctrl-Z in the editor to revert.`;
  }
  if (undo.kind === "create_note") {
    return `Created note '${r.title ?? toolName}'`;
  }
  return `Created folder '${r.path ?? toolName}'`;
}
