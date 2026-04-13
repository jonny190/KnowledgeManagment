import type { AiProvider, AiProviderRequest, AiToolContext, AiUsageRecord } from "../types";
import type { AiSseEvent } from "@km/shared";

export class StubProvider implements AiProvider {
  name = "stub";
  model = "stub-model";

  constructor(
    private readonly script: Array<
      | { type: "text"; delta: string }
      | { type: "tool_use"; id: string; name: string; args: unknown }
    > = [{ type: "text", delta: "stub response" }],
  ) {}

  async stream(
    _req: AiProviderRequest,
    _ctx: AiToolContext,
    emit: (event: AiSseEvent) => void,
  ): Promise<AiUsageRecord> {
    for (const step of this.script) {
      if (step.type === "text") {
        emit({ type: "text", delta: step.delta });
      } else {
        emit({ type: "tool_use", id: step.id, name: step.name, args: step.args });
      }
    }
    return {
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      model: this.model,
    };
  }
}
