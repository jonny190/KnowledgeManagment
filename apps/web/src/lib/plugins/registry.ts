import type { Disposable, PluginCommand, StatusBarItem } from "@km/shared";

type Bucket<T> = Map<string, { pluginId: string; item: T }>;

export class PluginRegistry {
  commands: Bucket<PluginCommand> = new Map();
  statusItems: Bucket<StatusBarItem> = new Map();
  editorExtensions: Bucket<unknown> = new Map();
  noteOpen: Bucket<(n: { id: string; title: string }) => void> = new Map();
  noteSave: Bucket<(n: { id: string; title: string; content: string }) => void> = new Map();

  private counter = 0;
  revision = 0;
  private listeners = new Set<() => void>();

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  private bump() {
    this.revision += 1;
    for (const cb of this.listeners) cb();
  }

  private addToBucket<T>(bucket: Bucket<T>, pluginId: string, item: T): Disposable {
    const key = `${pluginId}:${++this.counter}`;
    bucket.set(key, { pluginId, item });
    this.bump();
    return {
      dispose: () => {
        bucket.delete(key);
        this.bump();
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
  onNoteOpen(pluginId: string, handler: (n: { id: string; title: string }) => void) {
    return this.addToBucket(this.noteOpen, pluginId, handler);
  }
  onNoteSave(pluginId: string, handler: (n: { id: string; title: string; content: string }) => void) {
    return this.addToBucket(this.noteSave, pluginId, handler);
  }

  emitNoteOpen(note: { id: string; title: string }) {
    for (const { item } of this.noteOpen.values()) item(note);
    this.bump();
  }
  emitNoteSave(note: { id: string; title: string; content: string }) {
    for (const { item } of this.noteSave.values()) item(note);
    this.bump();
  }
}

export const pluginRegistry = new PluginRegistry();
