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
