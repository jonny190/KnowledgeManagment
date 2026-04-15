// src/index.ts
var plugin = {
  id: "wordcount",
  name: "Word count",
  version: "1.0.0",
  activate(ctx) {
    console.log("[wordcount] activate called");
    let count = 0;
    ctx.onNoteOpen(() => {
      console.log("[wordcount] onNoteOpen");
      count = 0;
    });
    ctx.onNoteSave((note) => {
      count = note.content.trim().split(/\s+/).filter(Boolean).length;
      console.log("[wordcount] onNoteSave", count);
    });
    ctx.registerStatusBarItem({
      id: "wordcount:status",
      render: () => `${count} words`
    });
    console.log("[wordcount] status bar registered");
  }
};
export {
  plugin
};
