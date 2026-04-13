import { yCollab } from "y-codemirror.next";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import type { Extension } from "@codemirror/state";

export interface CollabExtensionOptions {
  ytext: Y.Text;
  awareness: Awareness;
}

export function collabExtension(opts: CollabExtensionOptions): Extension {
  return yCollab(opts.ytext, opts.awareness);
}
