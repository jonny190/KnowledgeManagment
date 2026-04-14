import type { PluginContext, PluginDefinition } from "@km/shared";
import { pluginRegistry } from "./registry";

export function makePluginContext(
  def: PluginDefinition,
  opts: { vaultId: string; userId: string },
): PluginContext {
  return {
    vaultId: opts.vaultId,
    userId: opts.userId,
    registerCommand: (c) => pluginRegistry.registerCommand(def.id, c),
    registerStatusBarItem: (s) => pluginRegistry.registerStatusBarItem(def.id, s),
    registerEditorExtension: (e) => pluginRegistry.registerEditorExtension(def.id, e),
    onNoteOpen: (h) => pluginRegistry.onNoteOpen(def.id, h),
    onNoteSave: (h) => pluginRegistry.onNoteSave(def.id, h),
  };
}
