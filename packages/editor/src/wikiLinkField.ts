import { StateField, EditorState, Transaction } from '@codemirror/state';
import { parseWikiLinks } from '@km/shared';

export interface EditorWikiLink {
  title: string;
  alias?: string;
  from: number;
  to: number;
}

function compute(doc: string): EditorWikiLink[] {
  return parseWikiLinks(doc).map((m) => ({
    title: m.title,
    alias: m.alias,
    from: m.start,
    to: m.end,
  }));
}

export const wikiLinkField = StateField.define<EditorWikiLink[]>({
  create(state) {
    return compute(state.doc.toString());
  },
  update(value, tr: Transaction) {
    if (!tr.docChanged) return value;
    return compute(tr.newDoc.toString());
  },
});

export function getWikiLinks(state: EditorState): EditorWikiLink[] {
  return state.field(wikiLinkField);
}
