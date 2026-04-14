import { z } from "zod";
import type { ReactNode } from "react";

export type Disposable = { dispose: () => void };

export interface PluginCommand {
  id: string;
  label: string;
  group?: string;
  run: () => void | Promise<void>;
}

export interface StatusBarItem {
  id: string;
  render: () => ReactNode;
}

/**
 * Extension is typed as unknown here so that @km/shared does not need to
 * depend on @codemirror/state directly. Consumers that wire editor extensions
 * cast to the correct CM6 Extension type on their side.
 */
export interface PluginContext {
  registerCommand(cmd: PluginCommand): Disposable;
  registerStatusBarItem(item: StatusBarItem): Disposable;
  registerEditorExtension(extension: unknown): Disposable;
  onNoteOpen(handler: (note: { id: string; title: string }) => void): Disposable;
  onNoteSave(
    handler: (note: { id: string; title: string; content: string }) => void,
  ): Disposable;
  readonly vaultId: string;
  readonly userId: string;
}

export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export const pluginDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  activate: z.function(),
  deactivate: z.function().optional(),
});
