import { prisma } from "@km/db";

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  rank: number;
  updatedAt: Date;
}

const ALLOWED_TAG_RE = /<\/?mark>/g;
const SENTINEL_OPEN = "\uE000";
const SENTINEL_CLOSE = "\uE001";
const SENTINEL_RE = new RegExp(`${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`, "g");

function sanitiseSnippet(raw: string): string {
  const preserved: string[] = [];
  const replaced = raw.replace(ALLOWED_TAG_RE, (m) => {
    preserved.push(m);
    return `${SENTINEL_OPEN}${preserved.length - 1}${SENTINEL_CLOSE}`;
  });
  const escaped = replaced
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(SENTINEL_RE, (_, i) => preserved[Number(i)] ?? "");
}

export async function searchNotes(args: {
  vaultId: string;
  query: string;
  limit: number;
}): Promise<SearchHit[]> {
  const q = args.query.trim();
  if (q.length < 2) return [];

  const rows = await prisma.$queryRaw<
    Array<{ id: string; title: string; updated_at: Date; rank: number; snippet: string }>
  >`
    SELECT n.id, n.title, n."updatedAt" AS updated_at,
           ts_rank_cd(n."searchVector", q) AS rank,
           ts_headline('simple', n.content, q,
             'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=14, MinWords=4') AS snippet
    FROM "Note" n, websearch_to_tsquery('simple', ${q}) q
    WHERE n."vaultId" = ${args.vaultId} AND n."searchVector" @@ q
    ORDER BY rank DESC, n."updatedAt" DESC
    LIMIT ${args.limit};
  `;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: sanitiseSnippet(r.snippet ?? ""),
    rank: Number(r.rank),
    updatedAt: r.updated_at,
  }));
}
