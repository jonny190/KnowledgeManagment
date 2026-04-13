import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        switch (node.name) {
          case 'ATXHeading1':
          case 'SetextHeading1':
            builder.add(node.from, node.to, Decoration.mark({ class: 'cm-heading-1' }));
            break;
          case 'ATXHeading2':
          case 'SetextHeading2':
            builder.add(node.from, node.to, Decoration.mark({ class: 'cm-heading-2' }));
            break;
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6':
            builder.add(node.from, node.to, Decoration.mark({ class: 'cm-heading-3' }));
            break;
          case 'StrongEmphasis':
            builder.add(node.from, node.to, Decoration.mark({ class: 'cm-strong' }));
            break;
          case 'Emphasis':
            builder.add(node.from, node.to, Decoration.mark({ class: 'cm-emphasis' }));
            break;
          case 'InlineCode':
            builder.add(node.from, node.to, Decoration.mark({ class: 'cm-inline-code' }));
            break;
          case 'FencedCode':
          case 'CodeBlock':
            builder.add(node.from, node.to, Decoration.mark({ class: 'cm-code-block' }));
            break;
          default:
            break;
        }
      },
    });
  }
  return builder.finish();
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
