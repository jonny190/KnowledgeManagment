# Plugins

KnowledgeManagement supports a lightweight plugin system that lets you extend the editor experience with custom commands, status bar items, and CodeMirror editor extensions. Plugins are plain ESM JavaScript bundles loaded at runtime from a URL you provide.

## Plugin contract

Every plugin must export a named `plugin` export conforming to the `PluginDefinition` interface defined in `packages/shared/src/plugins.ts`.

```ts
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
```

The `activate` method receives a `PluginContext` and should register everything it needs. Disposables returned from each registration call are collected automatically and cleaned up when the plugin is disabled or the page unloads.

## Allow-list

Plugins run in the main browser window alongside the application, so only bundles served from trusted origins are accepted. The same-origin URL (the URL where your KnowledgeManagement instance is hosted) is always allowed. To allow additional origins, set the environment variable:

```
NEXT_PUBLIC_PLUGIN_ALLOWLIST=https://cdn.example.com,https://my-org.github.io
```

This is a comma-separated list of origin strings. Subpaths do not need to be listed; any path under an allowed origin is accepted. The variable is read at build time and baked into the client bundle, so a rebuild is required when you change it.

If a plugin URL fails the allow-list check the loader logs a warning and skips the bundle silently. No error is shown to the user.

## Wordcount plugin: a worked example

The repository ships a reference implementation under `examples/plugins/wordcount/`. It reads the saved note content and shows a running word count in the status bar.

Source (`examples/plugins/wordcount/src/index.ts`):

```ts
import type { PluginDefinition } from "@km/shared";

export const plugin: PluginDefinition = {
  id: "wordcount",
  name: "Word count",
  version: "1.0.0",
  activate(ctx) {
    let count = 0;
    ctx.onNoteOpen(() => {
      count = 0;
    });
    ctx.onNoteSave((note) => {
      count = note.content.trim().split(/\s+/).filter(Boolean).length;
    });
    ctx.registerStatusBarItem({
      id: "wordcount:status",
      render: () => `${count} words`,
    });
  },
};
```

### Building

```
pnpm --filter @km-examples/wordcount build
```

This writes `apps/web/public/plugins/wordcount.js`. When the development server is running, the bundle is available at `http://localhost:3000/plugins/wordcount.js` and can be installed from the plugins settings page.

### Installing

1. Open Settings then navigate to the Plugins section.
2. Paste `http://localhost:3000/plugins/wordcount.js` into the URL field.
3. Click Add.
4. Open any note, type some text, and wait for autosave. The status bar at the bottom of the editor will show the word count.

## v1 scope and limitations

v1 plugins run unsandboxed in the main window. This keeps the implementation simple but has implications you should be aware of.

Out of scope for v1:

- Sandboxing or iframe isolation
- A marketplace or signed-bundle registry
- Hot reload without a full page refresh
- Per-vault plugin permissions
- Persistence of plugin-registered data across reinstalls

These are planned for future versions. For now, only install plugins from sources you trust.
