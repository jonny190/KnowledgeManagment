import type { AiCommandName } from "@km/shared";

export interface CommandArgs {
  selection: string;
  language?: string;
}

export function buildCommandUserMessage(command: AiCommandName, args: CommandArgs): string {
  const block = "```\n" + args.selection + "\n```";
  switch (command) {
    case "summarize":
      return `Summarise the following text in three to five bullet points.\n\n${block}`;
    case "expand":
      return `Expand the following text with additional detail and examples while preserving its meaning.\n\n${block}`;
    case "rewrite":
      return `Rewrite the following text to be clearer and more direct, keeping the original meaning.\n\n${block}`;
    case "translate": {
      if (!args.language) {
        throw new Error("translate requires a language argument");
      }
      return `Translate the following text into ${args.language}. Return only the translation.\n\n${block}`;
    }
  }
}
