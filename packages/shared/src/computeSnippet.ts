const WINDOW = 120;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function computeSnippet(content: string, title: string): string {
  const re = new RegExp(`\\[\\[${escapeRegex(title)}(\\|[^\\]]*)?\\]\\]`);
  const m = content.match(re);
  if (!m || m.index === undefined) return '';

  const start = m.index;
  const end = start + m[0].length;
  const matchLen = m[0].length;
  const sideContext = Math.floor((WINDOW - matchLen) / 2);
  const from = Math.max(0, start - sideContext);
  const to = Math.min(content.length, from + WINDOW);

  const prefix = from > 0 ? '...' : '';
  const suffix = to < content.length ? '...' : '';
  return `${prefix}${content.slice(from, to)}${suffix}`;
}
