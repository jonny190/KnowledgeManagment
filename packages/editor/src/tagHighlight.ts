import { StateField, EditorState, Extension } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { parseTags } from "@km/shared";

const mark = Decoration.mark({ class: "cm-tag-pill" });

const field = StateField.define<DecorationSet>({
  create(state) {
    return build(state);
  },
  update(deco, tr) {
    return tr.docChanged ? build(tr.state) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function build(state: EditorState): DecorationSet {
  const matches = parseTags(state.doc.toString());
  return Decoration.set(matches.map((m) => mark.range(m.start, m.end)));
}

export function tagHighlight(): Extension {
  return [field];
}
tagHighlight.field = field;
