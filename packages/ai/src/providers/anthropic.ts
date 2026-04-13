import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, AiProviderRequest, AiToolContext, AiUsageRecord } from "../types";
import type { AiSseEvent } from "@km/shared";

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxOutputTokens: number;

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.maxOutputTokens = opts.maxOutputTokens ?? 2048;
  }

  async stream(
    req: AiProviderRequest,
    _ctx: AiToolContext,
    emit: (event: AiSseEvent) => void,
  ): Promise<AiUsageRecord> {
    const systemBlocks: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: req.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];
    if (req.cachedNoteContext) {
      systemBlocks.push({
        type: "text",
        text: req.cachedNoteContext.text,
        cache_control: { type: "ephemeral" },
      });
    }

    const tools = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.jsonSchema,
    }));

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;

    const stream = await this.client.messages.stream(
      {
        model: this.model,
        max_tokens: this.maxOutputTokens,
        system: systemBlocks as never,
        tools: tools as never,
        messages: req.history as never,
      },
      { signal: req.signal },
    );

    stream.on("text", (delta) => emit({ type: "text", delta }));
    stream.on("contentBlock", (block) => {
      if ((block as { type?: string }).type === "tool_use") {
        const tu = block as { id: string; name: string; input: unknown };
        emit({ type: "tool_use", id: tu.id, name: tu.name, args: tu.input });
      }
    });

    const final = await stream.finalMessage();
    inputTokens = final.usage?.input_tokens ?? 0;
    outputTokens = final.usage?.output_tokens ?? 0;
    cachedTokens =
      (final.usage as { cache_read_input_tokens?: number } | undefined)
        ?.cache_read_input_tokens ?? 0;

    return { inputTokens, outputTokens, cachedTokens, model: this.model };
  }
}
