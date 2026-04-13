import { AnthropicProvider } from "./anthropic";
import { StubProvider } from "./stub";
import type { AiProvider } from "../types";

export function getProvider(): AiProvider {
  if (process.env.AI_PROVIDER === "stub") {
    return new StubProvider();
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER is not 'stub'");
  }
  return new AnthropicProvider({
    apiKey,
    model: process.env.AI_MODEL ?? "claude-opus-4-6",
  });
}
