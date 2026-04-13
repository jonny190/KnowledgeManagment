import {
  CompletionContext,
  CompletionResult,
  CompletionSource,
  autocompletion,
} from '@codemirror/autocomplete';

export interface WikiSearchResult {
  id: string;
  title: string;
}

export interface WikiLinkSourceDeps {
  search: (query: string) => Promise<WikiSearchResult[]>;
}

export function buildWikiLinkSource(deps: WikiLinkSourceDeps): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const open = before.lastIndexOf('[[');
    if (open === -1) return null;
    const between = before.slice(open + 2);
    if (between.includes(']]')) return null;
    if (between.includes('\n')) return null;

    const query = between;
    const from = line.from + open + 2;

    let results: WikiSearchResult[] = [];
    try {
      results = await deps.search(query);
    } catch {
      return null;
    }

    return {
      from,
      to: ctx.pos,
      validFor: /^[^\]\n]*$/,
      options: results.map((r) => ({
        label: r.title,
        type: 'variable',
        apply: `${r.title}]] `,
      })),
    };
  };
}

export function wikiLinkAutocomplete(deps: WikiLinkSourceDeps) {
  return autocompletion({
    override: [buildWikiLinkSource(deps)],
    activateOnTyping: true,
    maxRenderedOptions: 20,
  });
}
