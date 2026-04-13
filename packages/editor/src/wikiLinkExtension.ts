import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { getWikiLinks } from './wikiLinkField';

export interface WikiLinkContext {
  resolveTitle: (title: string) => { noteId: string } | null;
  onNavigate: (noteId: string) => void;
  onCreateRequest: (title: string) => void;
}

function buildDecorations(view: EditorView, ctx: WikiLinkContext): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const links = getWikiLinks(view.state);
  for (const l of links) {
    const resolved = ctx.resolveTitle(l.title);
    builder.add(
      l.from,
      l.to,
      Decoration.mark({
        class: resolved ? 'cm-wiki-link' : 'cm-wiki-link cm-wiki-link-unresolved',
        attributes: {
          'data-wiki-title': l.title,
          'data-wiki-from': String(l.from),
          'data-wiki-to': String(l.to),
        },
      }),
    );
  }
  return builder.finish();
}

export function wikiLinkExtension(ctx: WikiLinkContext) {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, ctx);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || u.transactions.length > 0) {
            this.decorations = buildDecorations(u.view, ctx);
          }
        }
      },
      {
        decorations: (v) => v.decorations,
        eventHandlers: {
          mousedown(this: { decorations: DecorationSet }, event: MouseEvent) {
            const target = event.target as HTMLElement | null;
            if (!target) return false;
            const el = target.closest('.cm-wiki-link') as HTMLElement | null;
            if (!el) return false;
            if (!(event.metaKey || event.ctrlKey || event.button === 1 || event.detail === 2)) {
              return false;
            }
            const title = el.getAttribute('data-wiki-title');
            if (!title) return false;
            event.preventDefault();
            const resolved = ctx.resolveTitle(title);
            if (resolved) ctx.onNavigate(resolved.noteId);
            else ctx.onCreateRequest(title);
            return true;
          },
        },
      },
    ),
  ];
}

// Exported for future phases that want to render pills as widgets.
export class WikiLinkWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }
  override eq(other: WikiLinkWidget) {
    return other.title === this.title;
  }
  override toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-wiki-link';
    span.textContent = this.title;
    return span;
  }
}
