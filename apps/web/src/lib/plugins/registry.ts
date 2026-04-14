import type { Disposable, PluginCommand, StatusBarItem } from "@km/shared";

type Bucket<T> = Map<string, { pluginId: string; item: T }>;

export class PluginRegistry {
  commands: Bucket<PluginCommand> = new Map();
  statusItems: Bucket<StatusBarItem> = new Map();
  editorExtensions: Bucket<unknown> = new Map();
  noteOpen: Bucket<(n: any) => void> = new Map();
  noteSave: Bucket<(n: any) => void> = new Map();

  private counter = 0;

  private addToBucket<T>(bucket: Bucket<T>, pluginId: string, item: T): Disposable {
    const key = `${pluginId}:${++this.counter}`;
    bucket.set(key, { pluginId, item });
    return {
      dispose: () => {
        bucket.delete(key);
      },
    };
  }

  registerCommand(pluginId: string, cmd: PluginCommand) {
    return this.addToBucket(this.commands, pluginId, cmd);
  }
  registerStatusBarItem(pluginId: string, item: StatusBarItem) {
    return this.addToBucket(this.statusItems, pluginId, item);
  }
  registerEditorExtension(pluginId: string, ext: unknown) {
    return this.addToBucket(this.editorExtensions, pluginId, ext);
  }
  onNoteOpen(pluginId: string, handler: (n: any) => void) {
    return this.addToBucket(this.noteOpen, pluginId, handler);
  }
  onNoteSave(pluginId: string, handler: (n: any) => void) {
    return this.addToBucket(this.noteSave, pluginId, handler);
  }

  emitNoteOpen(note: { id: string; title: string }) {
    for (const { item } of this.noteOpen.values()) item(note);
  }
  emitNoteSave(note: { id: string; title: string; content: string }) {
    for (const { item } of this.noteSave.values()) item(note);
  }
}

export const pluginRegistry = new PluginRegistry();
