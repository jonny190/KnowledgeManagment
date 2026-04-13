import { type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

const SUPPORTED = ["summarize", "expand", "rewrite", "translate"] as const;
type SupportedCommand = (typeof SUPPORTED)[number];

export interface ParsedCommand {
  command: SupportedCommand;
  language?: string;
}

export function parseSlashCommand(text: string): ParsedCommand | null {
  const match = text.trim().match(/^\/(\w+)(?:\s+(.+))?$/);
  if (!match) return null;
  const name = match[1] as SupportedCommand;
  if (!SUPPORTED.includes(name)) return null;
  if (name === "translate") {
    return { command: name, language: match[2] ?? "English" };
  }
  return { command: name };
}

export function captureContext(state: EditorState): string {
  const { from, to } = state.selection.main;
  if (from !== to) return state.sliceDoc(from, to);
  const line = state.doc.lineAt(from);
  return line.text;
}

export interface AiCommandsOptions {
  onCommand: (cmd: ParsedCommand & { selection: string }) => void;
  promptForLine?: (defaultText: string) => Promise<string | null>;
}

export function aiCommands(opts: AiCommandsOptions): Extension {
  return keymap.of([
    {
      key: "Mod-Shift-k",
      run(view) {
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        const promptFn =
          opts.promptForLine ??
          (async (def) =>
            typeof window !== "undefined" ? window.prompt("AI command (e.g. /summarize)", def) : null);
        promptFn(line.text.startsWith("/") ? line.text : "/summarize").then((entered) => {
          if (!entered) return;
          const parsed = parseSlashCommand(entered);
          if (!parsed) return;
          const selection = captureContext(view.state);
          opts.onCommand({ ...parsed, selection });
        });
        return true;
      },
    },
  ]);
}
