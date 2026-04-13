export interface WikiLinkMatch {
  title: string;
  alias?: string;
  start: number;
  end: number;
}

const FENCE_RE = /^(```|~~~)/;

export function parseWikiLinks(content: string): WikiLinkMatch[] {
  if (!content) return [];

  const matches: WikiLinkMatch[] = [];
  const lines = content.split('\n');
  let offset = 0;
  let inFence = false;

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      inFence = !inFence;
      offset += line.length + 1;
      continue;
    }
    if (inFence) {
      offset += line.length + 1;
      continue;
    }

    let inInlineCode = false;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '`') {
        inInlineCode = !inInlineCode;
        i += 1;
        continue;
      }
      if (inInlineCode) {
        i += 1;
        continue;
      }
      if (ch === '\\' && line[i + 1] === '[') {
        i += 2;
        continue;
      }
      if (ch === '[' && line[i + 1] === '[') {
        const close = line.indexOf(']]', i + 2);
        if (close === -1) {
          i += 2;
          continue;
        }
        const inner = line.slice(i + 2, close);
        const pipe = inner.indexOf('|');
        let title: string;
        let alias: string | undefined;
        if (pipe === -1) {
          title = inner.trim();
        } else {
          title = inner.slice(0, pipe).trim();
          alias = inner.slice(pipe + 1).trim();
          if (alias.length === 0) alias = undefined;
        }
        if (title.length > 0) {
          matches.push({
            title,
            alias,
            start: offset + i,
            end: offset + close + 2,
          });
        }
        i = close + 2;
        continue;
      }
      i += 1;
    }
    offset += line.length + 1;
  }

  return matches;
}
