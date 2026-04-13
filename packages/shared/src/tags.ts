export interface TagMatch {
  name: string;
  start: number;
  end: number;
}

export function parseTags(content: string): TagMatch[] {
  const out: TagMatch[] = [];
  if (!content) return out;
  const lines = content.split(/\r?\n/);
  let offset = 0;
  let inFenced = false;
  for (const line of lines) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      inFenced = !inFenced;
    } else if (!inFenced) {
      let i = 0;
      let inCode = false;
      while (i < line.length) {
        const ch = line[i];
        if (ch === "`") {
          inCode = !inCode;
          i++;
          continue;
        }
        if (!inCode && ch === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
          const rest = line.slice(i + 1);
          const match = /^([a-z0-9][a-z0-9_\-/]*)/i.exec(rest);
          if (match) {
            const raw = match[1]!;
            const name = raw.toLowerCase();
            const start = offset + i;
            const end = start + 1 + raw.length;
            out.push({ name, start, end });
            i += 1 + raw.length;
            continue;
          }
        }
        i++;
      }
    }
    offset += line.length + 1;
  }
  return out;
}
