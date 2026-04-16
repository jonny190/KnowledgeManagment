import type { AiProvider, AiProviderRequest, AiToolContext, AiUsageRecord } from "../types";
import type { AiSseEvent } from "@km/shared";

type StubStep =
  | { type: "text"; delta: string }
  | { type: "tool_use"; id: string; name: string; args: unknown };

export interface StubToolCallMode {
  mode: "tool-then-finish";
  toolUse: { id: string; name: string; args: unknown };
  finishText?: string;
}

export class StubProvider implements AiProvider {
  name = "stub";
  model = "stub-model";
  private calls = 0;

  constructor(
    private readonly config:
      | StubStep[]
      | StubToolCallMode = [{ type: "text", delta: "stub response" }],
  ) {}

  async stream(
    _req: AiProviderRequest,
    _ctx: AiToolContext,
    emit: (event: AiSseEvent) => void,
  ): Promise<AiUsageRecord> {
    this.calls += 1;
    if (Array.isArray(this.config)) {
      for (const step of this.config) {
        if (step.type === "text") emit({ type: "text", delta: step.delta });
        else emit({ type: "tool_use", id: step.id, name: step.name, args: step.args });
      }
    } else if (this.config.mode === "tool-then-finish") {
      if (this.calls === 1) {
        const t = this.config.toolUse;
        emit({ type: "tool_use", id: t.id, name: t.name, args: t.args });
      } else {
        emit({ type: "text", delta: this.config.finishText ?? "done" });
      }
    }
    return { inputTokens: 10, outputTokens: 5, cachedTokens: 0, model: this.model };
  }
}
