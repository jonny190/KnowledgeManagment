# Phase 5 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-text search, tags, a graph view, a command palette, a minimal plugin system, and dark mode on top of the merged Foundation, Realtime, AI, and Diagrams phases.

**Architecture:** Search runs on a Postgres `tsvector` generated column with a GIN index; tags are parsed from note content on save and stored in `Tag` and `NoteTag` tables by the same transaction that recomputes `Link`. The graph page queries a small JSON graph and renders it with Cytoscape.js. A global `cmdk` palette aggregates notes, tags, core commands, and plugin-registered commands. Plugins are typed ES modules loaded by URL from an allow-list, activating against a `PluginContext` that exposes command, status-bar, and editor-extension registration. Dark mode is driven by CSS variables and a CodeMirror theme variant.

**Tech Stack:** Prisma 5, Postgres 15, `tsvector`, `websearch_to_tsquery`, `ts_headline`, `ts_rank_cd`, Cytoscape.js, `cytoscape-fcose`, `cmdk`, zod, React Query, CodeMirror 6, `tsup`, Vitest, Playwright.

---

## File Structure

New files:

- `packages/db/prisma/migrations/<timestamp>_phase5_polish/migration.sql`
- `packages/shared/src/parseTags.ts`
- `packages/shared/src/parseTags.test.ts`
- `packages/shared/src/plugins.ts`
- `packages/shared/src/plugins.test.ts`
- `apps/web/src/lib/recomputeLinksAndTags.ts`
- `apps/web/src/lib/recomputeLinksAndTags.test.ts`
- `apps/web/src/lib/search.ts`
- `apps/web/src/lib/search.test.ts`
- `apps/web/src/lib/graph.ts`
- `apps/web/src/lib/graph.test.ts`
- `apps/web/src/lib/plugins/loader.ts`
- `apps/web/src/lib/plugins/loader.test.ts`
- `apps/web/src/lib/plugins/context.ts`
- `apps/web/src/lib/plugins/registry.ts`
- `apps/web/src/app/api/search/route.ts`
- `apps/web/src/app/api/search/route.test.ts`
- `apps/web/src/app/api/vaults/[vaultId]/tags/route.ts`
- `apps/web/src/app/api/vaults/[vaultId]/graph/route.ts`
- `apps/web/src/app/api/plugins/route.ts`
- `apps/web/src/app/api/plugins/[id]/route.ts`
- `apps/web/src/app/(app)/search/page.tsx`
- `apps/web/src/app/(app)/vault/[vaultId]/tags/[name]/page.tsx`
- `apps/web/src/app/(app)/vault/[vaultId]/graph/page.tsx`
- `apps/web/src/app/(app)/settings/plugins/page.tsx`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/TagsSidebar.tsx`
- `apps/web/src/components/StatusBar.tsx`
- `apps/web/src/components/ThemeProvider.tsx`
- `apps/web/src/components/ThemeToggle.tsx`
- `apps/web/src/styles/theme.css`
- `packages/editor/src/tagHighlight.ts`
- `packages/editor/src/tagHighlight.test.ts`
- `packages/editor/src/theme.ts`
- `examples/plugins/wordcount/package.json`
- `examples/plugins/wordcount/tsup.config.ts`
- `examples/plugins/wordcount/src/index.ts`
- `apps/web/public/plugins/wordcount.js` (built artefact)
- `apps/web/playwright/search-and-tags.spec.ts`
- `apps/web/playwright/graph.spec.ts`
- `apps/web/playwright/plugins.spec.ts`
- `docs/plugins.md`
- `guides/searching-and-tagging.md`
- `guides/installing-plugins.md`

Modified files:

- `packages/db/prisma/schema.prisma`
- `packages/shared/src/index.ts`
- `packages/editor/src/index.ts`
- `packages/editor/src/NoteEditor.tsx`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/realtime/src/snapshot.ts` (switch to `recomputeLinksAndTags`)
- `apps/web/src/app/api/notes/[id]/route.ts` (remove title-only search, use shared helper)
- `env.example`
- `docs/architecture.md`
- `docs/data-model.md`

---

## Task 1: Prisma migration for tsvector, Tag, NoteTag, UserPlugin

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_phase5_polish/migration.sql`

- [ ] **Step 1: Extend the schema**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model Tag {
  id        String   @id @default(cuid())
  vaultId   String
  name      String
  createdAt DateTime @default(now())

  vault    Vault     @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  noteTags NoteTag[]

  @@unique([vaultId, name])
  @@index([vaultId])
}

model NoteTag {
  noteId String
  tagId  String

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([noteId, tagId])
  @@index([tagId])
}

model UserPlugin {
  id          String   @id @default(cuid())
  userId      String
  url         String
  enabled     Boolean  @default(true)
  installedAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, url])
  @@index([userId])
}
```

Inside `model Note`, add:

```prisma
  tags         NoteTag[]
  searchVector Unsupported("tsvector")?

  @@index([searchVector], type: Gin)
```

Inside `model Vault`, add:

```prisma
  tags Tag[]
```

Inside `model User`, add:

```prisma
  plugins         UserPlugin[]
  themePreference String       @default("system")
```

- [ ] **Step 2: Create migration folder with raw SQL**

Run:

```
pnpm --filter @km/db exec prisma migrate dev --name phase5_polish --create-only
```

Then append to the generated `migration.sql` (Prisma will not emit tsvector SQL from the `Unsupported` field):

```sql
ALTER TABLE "Note"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("content", '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS "Note_searchVector_idx"
  ON "Note" USING GIN ("searchVector");
```

- [ ] **Step 3: Apply migration and regenerate client**

```
pnpm --filter @km/db exec prisma migrate deploy
pnpm --filter @km/db generate
```

Expected: "All migrations have been successfully applied." and regenerated client.

- [ ] **Step 4: Commit**

```
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add tsvector, Tag, NoteTag, UserPlugin for phase 5"
```

---

## Task 2: parseTags pure function in @km/shared

**Files:**
- Create: `packages/shared/src/parseTags.ts`
- Create: `packages/shared/src/parseTags.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/parseTags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTags } from "./parseTags";

describe("parseTags", () => {
  it("finds simple tags", () => {
    const r = parseTags("hello #draft and #Published");
    expect(r.map((t) => t.name)).toEqual(["draft", "published"]);
  });

  it("keeps slash paths as one tag", () => {
    const r = parseTags("#project/alpha");
    expect(r.map((t) => t.name)).toEqual(["project/alpha"]);
  });

  it("ignores tags inside fenced code", () => {
    expect(parseTags("```\n#notatag\n```\n")).toEqual([]);
  });

  it("ignores tags inside inline code", () => {
    expect(parseTags("text `#notatag` more")).toEqual([]);
  });

  it("ignores url fragments like page#section", () => {
    expect(parseTags("see http://x/page#section here")).toEqual([]);
  });

  it("ignores numeric only like #123", () => {
    expect(parseTags("issue #123 here")).toEqual([]);
  });

  it("strips trailing punctuation", () => {
    const r = parseTags("see #draft.");
    expect(r[0].name).toBe("draft");
  });
});
```

- [ ] **Step 2: Run the failing tests**

```
pnpm --filter @km/shared test -- parseTags.test.ts
```

Expected: FAIL with "Cannot find module './parseTags'".

- [ ] **Step 3: Implement parseTags**

Create `packages/shared/src/parseTags.ts`:

```ts
export interface TagMatch {
  name: string;
  start: number;
  end: number;
}

const TAG_CHAR = /[A-Za-z0-9_\-/]/;
const FENCE_RE = /^(```|~~~)/;

export function parseTags(content: string): TagMatch[] {
  if (!content) return [];
  const matches: TagMatch[] = [];
  const lines = content.split("\n");
  let offset = 0;
  let inFence = false;

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      offset += line.length + 1;
      continue;
    }
    if (inFence) {
      offset += line.length + 1;
      continue;
    }
    let inInline = false;
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === "`") {
        inInline = !inInline;
        i += 1;
        continue;
      }
      if (inInline) {
        i += 1;
        continue;
      }
      if (ch === "#") {
        const prev = i > 0 ? line[i - 1] : "";
        if (/[A-Za-z0-9]/.test(prev)) {
          i += 1;
          continue;
        }
        let j = i + 1;
        while (j < line.length && TAG_CHAR.test(line[j])) j += 1;
        let raw = line.slice(i + 1, j);
        raw = raw.replace(/[\-/]+$/g, "");
        if (raw.length === 0 || /^\d+$/.test(raw)) {
          i = j;
          continue;
        }
        matches.push({
          name: raw.toLowerCase(),
          start: offset + i,
          end: offset + i + 1 + raw.length,
        });
        i = j;
        continue;
      }
      i += 1;
    }
    offset += line.length + 1;
  }
  return matches;
}
```

- [ ] **Step 4: Re-export from package index**

In `packages/shared/src/index.ts` add:

```ts
export * from "./parseTags";
```

- [ ] **Step 5: Run tests**

```
pnpm --filter @km/shared test -- parseTags.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add packages/shared/src/parseTags.ts packages/shared/src/parseTags.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add parseTags pure function"
```

---

## Task 3: recomputeLinksAndTags helper

**Files:**
- Create: `apps/web/src/lib/recomputeLinksAndTags.ts`
- Create: `apps/web/src/lib/recomputeLinksAndTags.test.ts`
- Modify: `apps/realtime/src/snapshot.ts`
- Modify: `apps/web/src/lib/links.ts` (delete, superseded)

- [ ] **Step 1: Write failing integration test**

Create `apps/web/src/lib/recomputeLinksAndTags.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { recomputeLinksAndTags } from "./recomputeLinksAndTags";
import { makeVaultWithNotes } from "../test/factories";

describe("recomputeLinksAndTags", () => {
  beforeEach(async () => {
    await prisma.noteTag.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.link.deleteMany();
    await prisma.note.deleteMany();
  });

  it("creates tags on first save", async () => {
    const { vault, notes } = await makeVaultWithNotes(["Hello"]);
    await prisma.$transaction((tx) =>
      recomputeLinksAndTags(tx, notes[0].id, vault.id, "body with #draft and #published"),
    );
    const tags = await prisma.tag.findMany({ where: { vaultId: vault.id } });
    expect(tags.map((t) => t.name).sort()).toEqual(["draft", "published"]);
    const nt = await prisma.noteTag.findMany({ where: { noteId: notes[0].id } });
    expect(nt).toHaveLength(2);
  });

  it("removes stale tag joins when a tag is deleted from content", async () => {
    const { vault, notes } = await makeVaultWithNotes(["Hello"]);
    await prisma.$transaction((tx) =>
      recomputeLinksAndTags(tx, notes[0].id, vault.id, "#alpha #beta"),
    );
    await prisma.$transaction((tx) =>
      recomputeLinksAndTags(tx, notes[0].id, vault.id, "#alpha only"),
    );
    const nt = await prisma.noteTag.findMany({ where: { noteId: notes[0].id } });
    expect(nt).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the failing test**

```
pnpm --filter @km/web test -- recomputeLinksAndTags.test.ts
```

Expected: FAIL with "Cannot find module './recomputeLinksAndTags'".

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/recomputeLinksAndTags.ts`:

```ts
import type { Prisma } from "@prisma/client";
import { parseWikiLinks, parseTags } from "@km/shared";

export async function recomputeLinksAndTags(
  tx: Prisma.TransactionClient,
  noteId: string,
  vaultId: string,
  markdown: string,
): Promise<void> {
  // Links
  const wiki = parseWikiLinks(markdown);
  const titles = [...new Set(wiki.map((w) => w.title))];
  const targets = titles.length
    ? await tx.note.findMany({
        where: { vaultId, title: { in: titles } },
        select: { id: true, title: true },
      })
    : [];
  const byTitle = new Map(targets.map((t) => [t.title, t.id]));
  await tx.link.deleteMany({ where: { sourceNoteId: noteId } });
  if (wiki.length) {
    await tx.link.createMany({
      data: wiki.map((w) => ({
        sourceNoteId: noteId,
        targetNoteId: byTitle.get(w.title) ?? null,
        targetTitle: w.title,
        resolved: byTitle.has(w.title),
      })),
    });
  }

  // Tags
  const tags = parseTags(markdown);
  const names = [...new Set(tags.map((t) => t.name))];
  await tx.noteTag.deleteMany({ where: { noteId } });
  if (names.length === 0) return;

  for (const name of names) {
    await tx.tag.upsert({
      where: { vaultId_name: { vaultId, name } },
      create: { vaultId, name },
      update: {},
    });
  }
  const rows = await tx.tag.findMany({
    where: { vaultId, name: { in: names } },
    select: { id: true },
  });
  await tx.noteTag.createMany({
    data: rows.map((r) => ({ noteId, tagId: r.id })),
    skipDuplicates: true,
  });
}
```

- [ ] **Step 4: Point the realtime snapshot at the new helper**

Edit `apps/realtime/src/snapshot.ts`, replace `recomputeLinks(tx, noteId, vaultId, markdown)` with:

```ts
await recomputeLinksAndTags(tx, noteId, vaultId, markdown);
```

and update the import:

```ts
import { recomputeLinksAndTags } from "../../../apps/web/src/lib/recomputeLinksAndTags";
```

If the realtime app does not already import from `apps/web`, move the helper into `@km/shared` instead (acceptable only because the helper has no Next-specific imports).

- [ ] **Step 5: Delete the old helper**

```
git rm apps/web/src/lib/links.ts apps/web/src/lib/links.test.ts
```

- [ ] **Step 6: Run tests**

```
pnpm --filter @km/web test -- recomputeLinksAndTags.test.ts
pnpm --filter apps/realtime test
```

Expected: pass.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "feat(web): recompute tags alongside links in one transaction"
```

---

## Task 4: search library

**Files:**
- Create: `apps/web/src/lib/search.ts`
- Create: `apps/web/src/lib/search.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/lib/search.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { searchNotes } from "./search";
import { makeVaultWithNotes } from "../test/factories";

describe("searchNotes", () => {
  beforeEach(async () => {
    await prisma.note.deleteMany();
  });

  it("returns empty for query shorter than 2 chars", async () => {
    const r = await searchNotes({ vaultId: "v", query: "a", limit: 10 });
    expect(r).toEqual([]);
  });

  it("ranks title matches above body matches", async () => {
    const { vault } = await makeVaultWithNotes([]);
    await prisma.note.create({
      data: { vaultId: vault.id, title: "Welcome", slug: "welcome", content: "intro text" },
    });
    await prisma.note.create({
      data: { vaultId: vault.id, title: "Other", slug: "other", content: "welcome in body" },
    });
    const r = await searchNotes({ vaultId: vault.id, query: "welcome", limit: 10 });
    expect(r[0].title).toBe("Welcome");
  });

  it("sanitises snippet to only <mark> tags", async () => {
    const { vault } = await makeVaultWithNotes([]);
    await prisma.note.create({
      data: {
        vaultId: vault.id,
        title: "Script",
        slug: "script",
        content: "hello <script>alert(1)</script> world",
      },
    });
    const r = await searchNotes({ vaultId: vault.id, query: "hello", limit: 10 });
    expect(r[0].snippet).not.toContain("<script>");
    expect(r[0].snippet).toContain("<mark>");
  });
});
```

- [ ] **Step 2: Run failing test**

```
pnpm --filter @km/web test -- search.test.ts
```

Expected: FAIL with "Cannot find module './search'".

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/lib/search.ts`:

```ts
import { prisma } from "@km/db";

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  rank: number;
  updatedAt: Date;
}

const ALLOWED_TAG_RE = /<\/?mark>/g;

function sanitiseSnippet(raw: string): string {
  const preserved: string[] = [];
  const replaced = raw.replace(ALLOWED_TAG_RE, (m) => {
    preserved.push(m);
    return `\u0000${preserved.length - 1}\u0000`;
  });
  const escaped = replaced
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\u0000(\d+)\u0000/g, (_, i) => preserved[Number(i)]);
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
           ts_headline('english', n.content, q,
             'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=14, MinWords=4') AS snippet
    FROM "Note" n, websearch_to_tsquery('english', ${q}) q
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
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @km/web test -- search.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```
git add apps/web/src/lib/search.ts apps/web/src/lib/search.test.ts
git commit -m "feat(web): searchNotes library with tsvector and sanitised snippets"
```

---

## Task 5: /api/search route

**Files:**
- Create: `apps/web/src/app/api/search/route.ts`
- Create: `apps/web/src/app/api/search/route.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/app/api/search/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";
import { mockSession, makeVaultWithNotes } from "@/test/factories";

describe("GET /api/search", () => {
  it("rejects unauthenticated requests", async () => {
    const r = await GET(new NextRequest("http://x/api/search?vaultId=v&q=hello"));
    expect(r.status).toBe(401);
  });

  it("rejects access to vaults the user cannot read", async () => {
    const { vault } = await makeVaultWithNotes([]);
    await mockSession("some-other-user");
    const r = await GET(new NextRequest(`http://x/api/search?vaultId=${vault.id}&q=hello`));
    expect(r.status).toBe(403);
  });

  it("returns results as JSON", async () => {
    const { vault, user } = await makeVaultWithNotes(["Welcome"]);
    await mockSession(user.id);
    const r = await GET(new NextRequest(`http://x/api/search?vaultId=${vault.id}&q=welcome`));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.results[0].title).toBe("Welcome");
  });
});
```

- [ ] **Step 2: Run failing test**

```
pnpm --filter @km/web test -- route.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { assertCanAccessVault } from "@/lib/authz";
import { searchNotes } from "@/lib/search";

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const vaultId = req.nextUrl.searchParams.get("vaultId") ?? "";
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 100);

  try {
    await assertCanAccessVault(userId, vaultId, "MEMBER");
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const results = await searchNotes({ vaultId, query: q, limit });
  return NextResponse.json({ results });
}
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @km/web test -- api/search
```

Expected: pass.

- [ ] **Step 5: Commit**

```
git add apps/web/src/app/api/search
git commit -m "feat(web): add GET /api/search endpoint"
```

---

## Task 6: Search page UI

**Files:**
- Create: `apps/web/src/app/(app)/search/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useActiveVault } from "@/hooks/useActiveVault";

export default function SearchPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const vaultId = useActiveVault();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const debouncedQ = useDebouncedValue(q, 200);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (debouncedQ) url.searchParams.set("q", debouncedQ);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }, [debouncedQ]);

  const { data } = useQuery({
    queryKey: ["search", vaultId, debouncedQ],
    enabled: !!vaultId && debouncedQ.length >= 2,
    queryFn: async () => {
      const r = await fetch(`/api/search?vaultId=${vaultId}&q=${encodeURIComponent(debouncedQ)}`);
      return r.json();
    },
  });

  return (
    <div className="p-6 max-w-3xl">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search notes..."
        className="w-full rounded border px-3 py-2 bg-[var(--bg)] text-[var(--fg)]"
      />
      <ul className="mt-4 space-y-2">
        {(data?.results ?? []).map((hit: any) => (
          <li
            key={hit.id}
            className="rounded border p-3 cursor-pointer hover:bg-[var(--border)]"
            onClick={() => router.push(`/vault/${vaultId}/note/${hit.id}`)}
          >
            <div className="font-medium">{hit.title}</div>
            <div
              className="text-sm text-[var(--muted)]"
              dangerouslySetInnerHTML={{ __html: hit.snippet }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add apps/web/src/app/\(app\)/search/page.tsx
git commit -m "feat(web): add search page with debounced tsquery results"
```

---

## Task 7: Tags API endpoints

**Files:**
- Create: `apps/web/src/app/api/vaults/[vaultId]/tags/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/auth";
import { assertCanAccessVault } from "@/lib/authz";

export async function GET(
  _req: NextRequest,
  { params }: { params: { vaultId: string } },
) {
  const userId = await requireUserId();
  await assertCanAccessVault(userId, params.vaultId, "MEMBER");

  const rows = await prisma.tag.findMany({
    where: { vaultId: params.vaultId },
    select: {
      name: true,
      _count: { select: { noteTags: true } },
    },
    orderBy: [{ noteTags: { _count: "desc" } }, { name: "asc" }],
  });

  return NextResponse.json({
    tags: rows.map((r) => ({ name: r.name, count: r._count.noteTags })),
  });
}
```

- [ ] **Step 2: Commit**

```
git add apps/web/src/app/api/vaults/\[vaultId\]/tags
git commit -m "feat(web): add GET /api/vaults/:id/tags"
```

---

## Task 8: TagsSidebar component

**Files:**
- Create: `apps/web/src/components/TagsSidebar.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useActiveVault } from "@/hooks/useActiveVault";

export function TagsSidebar() {
  const vaultId = useActiveVault();
  const { data } = useQuery({
    queryKey: ["tags", vaultId],
    enabled: !!vaultId,
    queryFn: async () => (await fetch(`/api/vaults/${vaultId}/tags`)).json(),
  });
  if (!vaultId) return null;
  return (
    <section aria-label="Tags" className="mt-4">
      <h3 className="px-3 py-1 text-xs uppercase text-[var(--muted)]">Tags</h3>
      <ul>
        {(data?.tags ?? []).map((t: { name: string; count: number }) => (
          <li key={t.name}>
            <Link
              href={`/vault/${vaultId}/tags/${encodeURIComponent(t.name)}`}
              className="flex justify-between px-3 py-1 hover:bg-[var(--border)]"
            >
              <span>#{t.name}</span>
              <span className="text-[var(--muted)]">{t.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Mount it in `AppShell.tsx` under the existing file tree section.

- [ ] **Step 2: Commit**

```
git add apps/web/src/components/TagsSidebar.tsx apps/web/src/components/AppShell.tsx
git commit -m "feat(web): add tags sidebar section"
```

---

## Task 9: Tag index page

**Files:**
- Create: `apps/web/src/app/(app)/vault/[vaultId]/tags/[name]/page.tsx`

- [ ] **Step 1: Implement**

```tsx
import Link from "next/link";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/auth";
import { assertCanAccessVault } from "@/lib/authz";

export default async function TagIndexPage({
  params,
}: {
  params: { vaultId: string; name: string };
}) {
  const userId = await requireUserId();
  await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  const name = decodeURIComponent(params.name).toLowerCase();

  const notes = await prisma.note.findMany({
    where: {
      vaultId: params.vaultId,
      tags: { some: { tag: { name } } },
    },
    select: { id: true, title: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold">#{name}</h1>
      <ul className="mt-4">
        {notes.map((n) => (
          <li key={n.id} className="py-1">
            <Link href={`/vault/${params.vaultId}/note/${n.id}`}>{n.title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add apps/web/src/app/\(app\)/vault/\[vaultId\]/tags
git commit -m "feat(web): add per-tag note index page"
```

---

## Task 10: Tag highlight editor extension

**Files:**
- Create: `packages/editor/src/tagHighlight.ts`
- Create: `packages/editor/src/tagHighlight.test.ts`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/src/NoteEditor.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/editor/src/tagHighlight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { tagHighlight } from "./tagHighlight";

describe("tagHighlight extension", () => {
  it("produces at least one decoration for a document with a tag", () => {
    const state = EditorState.create({
      doc: "body with #draft tag",
      extensions: [tagHighlight()],
    });
    const field = state.field(tagHighlight.field as any);
    expect(field.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run failing test**

```
pnpm --filter @km/editor test -- tagHighlight
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
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
```

Export from `packages/editor/src/index.ts`:

```ts
export { tagHighlight } from "./tagHighlight";
```

Include it in `NoteEditor.tsx`'s extension array.

- [ ] **Step 4: Run tests**

```
pnpm --filter @km/editor test
```

Expected: pass.

- [ ] **Step 5: Commit**

```
git add packages/editor/src/tagHighlight.ts packages/editor/src/tagHighlight.test.ts packages/editor/src/index.ts packages/editor/src/NoteEditor.tsx
git commit -m "feat(editor): add tag highlight extension"
```

---

## Task 11: Graph library and API

**Files:**
- Create: `apps/web/src/lib/graph.ts`
- Create: `apps/web/src/lib/graph.test.ts`
- Create: `apps/web/src/app/api/vaults/[vaultId]/graph/route.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/lib/graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildGraph } from "./graph";
import { makeVaultWithNotes, linkNotes, tagNote } from "../test/factories";

describe("buildGraph", () => {
  it("returns nodes, edges, backlink counts, and tags", async () => {
    const { vault, notes } = await makeVaultWithNotes(["A", "B", "C"]);
    await linkNotes(notes[0].id, notes[1].id);
    await linkNotes(notes[2].id, notes[1].id);
    await tagNote(notes[1].id, vault.id, "draft");

    const g = await buildGraph(vault.id);
    expect(g.nodes).toHaveLength(3);
    const b = g.nodes.find((n) => n.label === "B");
    expect(b?.backlinkCount).toBe(2);
    expect(b?.tags).toEqual(["draft"]);
    expect(g.edges).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run failing test**

```
pnpm --filter @km/web test -- graph.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/graph.ts`:

```ts
import { prisma } from "@km/db";

export interface GraphNode {
  id: string;
  label: string;
  backlinkCount: number;
  tags: string[];
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function buildGraph(vaultId: string): Promise<Graph> {
  const notes = await prisma.note.findMany({
    where: { vaultId },
    select: { id: true, title: true },
  });
  const ids = notes.map((n) => n.id);
  if (ids.length === 0) return { nodes: [], edges: [] };

  const links = await prisma.link.findMany({
    where: { sourceNoteId: { in: ids }, resolved: true, targetNoteId: { not: null } },
    select: { id: true, sourceNoteId: true, targetNoteId: true },
  });

  const tagRows = await prisma.noteTag.findMany({
    where: { noteId: { in: ids } },
    select: { noteId: true, tag: { select: { name: true } } },
  });

  const backlinks = new Map<string, number>();
  for (const l of links) {
    if (!l.targetNoteId) continue;
    backlinks.set(l.targetNoteId, (backlinks.get(l.targetNoteId) ?? 0) + 1);
  }

  const tagsByNote = new Map<string, string[]>();
  for (const row of tagRows) {
    const arr = tagsByNote.get(row.noteId) ?? [];
    arr.push(row.tag.name);
    tagsByNote.set(row.noteId, arr);
  }

  return {
    nodes: notes.map((n) => ({
      id: n.id,
      label: n.title,
      backlinkCount: backlinks.get(n.id) ?? 0,
      tags: tagsByNote.get(n.id) ?? [],
    })),
    edges: links.map((l) => ({
      id: l.id,
      source: l.sourceNoteId,
      target: l.targetNoteId!,
    })),
  };
}
```

Create `apps/web/src/app/api/vaults/[vaultId]/graph/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { assertCanAccessVault } from "@/lib/authz";
import { buildGraph } from "@/lib/graph";

export async function GET(
  _req: Request,
  { params }: { params: { vaultId: string } },
) {
  const userId = await requireUserId();
  await assertCanAccessVault(userId, params.vaultId, "MEMBER");
  return NextResponse.json(await buildGraph(params.vaultId));
}
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @km/web test -- graph
```

Expected: pass.

- [ ] **Step 5: Commit**

```
git add apps/web/src/lib/graph.ts apps/web/src/lib/graph.test.ts apps/web/src/app/api/vaults
git commit -m "feat(web): add graph builder and endpoint"
```

---

## Task 12: Graph page with Cytoscape

**Files:**
- Create: `apps/web/src/app/(app)/vault/[vaultId]/graph/page.tsx`
- Modify: `apps/web/package.json` (add `cytoscape`, `cytoscape-fcose`)

- [ ] **Step 1: Install deps**

```
pnpm --filter @km/web add cytoscape cytoscape-fcose
pnpm --filter @km/web add -D @types/cytoscape
```

- [ ] **Step 2: Implement the page**

```tsx
"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useRouter, useParams } from "next/navigation";

cytoscape.use(fcose);

export default function GraphPage() {
  const { vaultId } = useParams<{ vaultId: string }>();
  const router = useRouter();
  const ref = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [data, setData] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [filter, setFilter] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/vaults/${vaultId}/graph`).then((r) => r.json()).then(setData);
  }, [vaultId]);

  useEffect(() => {
    if (!data || !ref.current) return;
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...data.nodes.map((n) => ({
          data: { ...n },
          style: { width: 10 + Math.sqrt(n.backlinkCount) * 6, height: 10 + Math.sqrt(n.backlinkCount) * 6 },
        })),
        ...data.edges.map((e) => ({ data: e })),
      ],
      layout: { name: "fcose", animate: false },
      style: [
        { selector: "node", style: { label: "data(label)", "background-color": "var(--accent)", color: "var(--fg)", "font-size": 10 } },
        { selector: "edge", style: { "line-color": "var(--border)", width: 1, opacity: 0.4 } },
        { selector: ".hidden", style: { display: "none" } },
      ],
    });
    cy.on("tap", "node", (evt) => {
      router.push(`/vault/${vaultId}/note/${evt.target.id()}`);
    });
    cyRef.current = cy;
    return () => cy.destroy();
  }, [data, vaultId, router]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((n) => {
      const label = (n.data("label") ?? "").toLowerCase();
      const tags = (n.data("tags") ?? []) as string[];
      const passFilter = filter.length === 0 || label.includes(filter.toLowerCase());
      const passTag = !activeTag || tags.includes(activeTag);
      n.toggleClass("hidden", !(passFilter && passTag));
    });
  }, [filter, activeTag, data]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    data?.nodes.forEach((n) => n.tags.forEach((t: string) => s.add(t)));
    return [...s].sort();
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 flex gap-2 border-b border-[var(--border)]">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title..."
          className="rounded border px-2 py-1 bg-[var(--bg)]"
        />
        <select
          value={activeTag ?? ""}
          onChange={(e) => setActiveTag(e.target.value || null)}
          className="rounded border px-2 py-1 bg-[var(--bg)]"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>#{t}</option>
          ))}
        </select>
        <button onClick={() => cyRef.current?.layout({ name: "fcose", animate: false }).run()}>
          Reset layout
        </button>
      </div>
      <div ref={ref} className="flex-1" />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```
git add apps/web/src/app/\(app\)/vault/\[vaultId\]/graph apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add graph view with Cytoscape fcose"
```

---

## Task 13: Plugin contract types in @km/shared

**Files:**
- Create: `packages/shared/src/plugins.ts`
- Create: `packages/shared/src/plugins.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { pluginDefinitionSchema } from "./plugins";

describe("pluginDefinitionSchema", () => {
  it("accepts a valid definition", () => {
    const d = pluginDefinitionSchema.parse({
      id: "wordcount",
      name: "Word count",
      version: "1.0.0",
      activate: () => {},
    });
    expect(d.id).toBe("wordcount");
  });

  it("rejects missing activate", () => {
    expect(() =>
      pluginDefinitionSchema.parse({ id: "x", name: "X", version: "1.0.0" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run failing test**

```
pnpm --filter @km/shared test -- plugins
```

- [ ] **Step 3: Implement**

```ts
import { z } from "zod";
import type { Extension } from "@codemirror/state";
import type { ReactNode } from "react";

export type Disposable = { dispose: () => void };

export interface PluginCommand {
  id: string;
  label: string;
  group?: string;
  run: () => void | Promise<void>;
}

export interface StatusBarItem {
  id: string;
  render: () => ReactNode;
}

export interface PluginContext {
  registerCommand(cmd: PluginCommand): Disposable;
  registerStatusBarItem(item: StatusBarItem): Disposable;
  registerEditorExtension(extension: Extension): Disposable;
  onNoteOpen(handler: (note: { id: string; title: string }) => void): Disposable;
  onNoteSave(
    handler: (note: { id: string; title: string; content: string }) => void,
  ): Disposable;
  readonly vaultId: string;
  readonly userId: string;
}

export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export const pluginDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  activate: z.function(),
  deactivate: z.function().optional(),
});
```

Re-export from `packages/shared/src/index.ts`.

- [ ] **Step 4: Run tests**

```
pnpm --filter @km/shared test
```

Expected: pass.

- [ ] **Step 5: Commit**

```
git add packages/shared/src/plugins.ts packages/shared/src/plugins.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add plugin contract types and schema"
```

---

## Task 14: Plugin loader and context

**Files:**
- Create: `apps/web/src/lib/plugins/context.ts`
- Create: `apps/web/src/lib/plugins/registry.ts`
- Create: `apps/web/src/lib/plugins/loader.ts`
- Create: `apps/web/src/lib/plugins/loader.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { loadPlugins } from "./loader";

describe("loadPlugins", () => {
  it("skips plugins whose url is not allow-listed", async () => {
    const res = await loadPlugins({
      urls: ["https://evil.example.com/p.js"],
      allowList: ["https://good.example.com"],
      origin: "https://app.example.com",
      vaultId: "v",
      userId: "u",
    });
    expect(res.loaded).toHaveLength(0);
    expect(res.errors[0].url).toBe("https://evil.example.com/p.js");
  });

  it("loads same-origin plugins by default", async () => {
    (globalThis as any).__plugin = {
      plugin: {
        id: "t",
        name: "T",
        version: "1.0.0",
        activate: vi.fn(),
      },
    };
    vi.stubGlobal("importShim", async () => (globalThis as any).__plugin);
    // The loader accepts an injectable importer for testing
    const res = await loadPlugins({
      urls: ["https://app.example.com/p.js"],
      allowList: [],
      origin: "https://app.example.com",
      vaultId: "v",
      userId: "u",
      importer: async () => (globalThis as any).__plugin,
    });
    expect(res.loaded).toHaveLength(1);
    expect((globalThis as any).__plugin.plugin.activate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing test**

```
pnpm --filter @km/web test -- plugins/loader
```

- [ ] **Step 3: Implement registry, context, and loader**

`apps/web/src/lib/plugins/registry.ts`:

```ts
import type { Disposable, PluginCommand, StatusBarItem } from "@km/shared";
import type { Extension } from "@codemirror/state";

type Bucket<T> = Map<string, { pluginId: string; item: T }>;

export class PluginRegistry {
  commands: Bucket<PluginCommand> = new Map();
  statusItems: Bucket<StatusBarItem> = new Map();
  editorExtensions: Bucket<Extension> = new Map();
  noteOpen: Bucket<(n: any) => void> = new Map();
  noteSave: Bucket<(n: any) => void> = new Map();

  private counter = 0;

  private addToBucket<T>(bucket: Bucket<T>, pluginId: string, item: T): Disposable {
    const key = `${pluginId}:${++this.counter}`;
    bucket.set(key, { pluginId, item });
    return { dispose: () => { bucket.delete(key); } };
  }

  registerCommand(pluginId: string, cmd: PluginCommand) {
    return this.addToBucket(this.commands, pluginId, cmd);
  }
  registerStatusBarItem(pluginId: string, item: StatusBarItem) {
    return this.addToBucket(this.statusItems, pluginId, item);
  }
  registerEditorExtension(pluginId: string, ext: Extension) {
    return this.addToBucket(this.editorExtensions, pluginId, ext);
  }
  onNoteOpen(pluginId: string, handler: (n: any) => void) {
    return this.addToBucket(this.noteOpen, pluginId, handler);
  }
  onNoteSave(pluginId: string, handler: (n: any) => void) {
    return this.addToBucket(this.noteSave, pluginId, handler);
  }

  emitNoteOpen(note: { id: string; title: string }) {
    for (const { item } of this.noteOpen.values()) item(note);
  }
  emitNoteSave(note: { id: string; title: string; content: string }) {
    for (const { item } of this.noteSave.values()) item(note);
  }
}

export const pluginRegistry = new PluginRegistry();
```

`apps/web/src/lib/plugins/context.ts`:

```ts
import type { PluginContext, PluginDefinition } from "@km/shared";
import { pluginRegistry } from "./registry";

export function makePluginContext(
  def: PluginDefinition,
  opts: { vaultId: string; userId: string },
): PluginContext {
  return {
    vaultId: opts.vaultId,
    userId: opts.userId,
    registerCommand: (c) => pluginRegistry.registerCommand(def.id, c),
    registerStatusBarItem: (s) => pluginRegistry.registerStatusBarItem(def.id, s),
    registerEditorExtension: (e) => pluginRegistry.registerEditorExtension(def.id, e),
    onNoteOpen: (h) => pluginRegistry.onNoteOpen(def.id, h),
    onNoteSave: (h) => pluginRegistry.onNoteSave(def.id, h),
  };
}
```

`apps/web/src/lib/plugins/loader.ts`:

```ts
import { pluginDefinitionSchema, type PluginDefinition } from "@km/shared";
import { makePluginContext } from "./context";

export interface LoadedPlugin {
  url: string;
  definition: PluginDefinition;
}
export interface LoadError { url: string; error: string }
export interface LoadResult { loaded: LoadedPlugin[]; errors: LoadError[] }

function isAllowed(url: string, origin: string, allowList: string[]): boolean {
  try {
    const u = new URL(url);
    if (u.origin === origin) return true;
    return allowList.some((entry) => url.startsWith(entry));
  } catch {
    return false;
  }
}

export async function loadPlugins(args: {
  urls: string[];
  allowList: string[];
  origin: string;
  vaultId: string;
  userId: string;
  importer?: (url: string) => Promise<any>;
}): Promise<LoadResult> {
  const loaded: LoadedPlugin[] = [];
  const errors: LoadError[] = [];
  const importer = args.importer ?? ((u: string) => import(/* @vite-ignore */ u));

  for (const url of args.urls) {
    if (!isAllowed(url, args.origin, args.allowList)) {
      errors.push({ url, error: "not-allow-listed" });
      continue;
    }
    try {
      const mod = await importer(url);
      const parsed = pluginDefinitionSchema.parse(mod.plugin);
      const ctx = makePluginContext(parsed as PluginDefinition, {
        vaultId: args.vaultId,
        userId: args.userId,
      });
      await parsed.activate(ctx);
      loaded.push({ url, definition: parsed as PluginDefinition });
    } catch (e: any) {
      errors.push({ url, error: e?.message ?? "load-failed" });
    }
  }

  return { loaded, errors };
}
```

- [ ] **Step 4: Run tests**

```
pnpm --filter @km/web test -- plugins/loader
```

Expected: pass.

- [ ] **Step 5: Commit**

```
git add apps/web/src/lib/plugins
git commit -m "feat(web): add plugin loader, registry, and context"
```

---

## Task 15: Plugin CRUD API

**Files:**
- Create: `apps/web/src/app/api/plugins/route.ts`
- Create: `apps/web/src/app/api/plugins/[id]/route.ts`

- [ ] **Step 1: Implement list + add**

`apps/web/src/app/api/plugins/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/auth";

const addSchema = z.object({ url: z.string().url() });

export async function GET() {
  const userId = await requireUserId();
  const rows = await prisma.userPlugin.findMany({
    where: { userId },
    orderBy: { installedAt: "asc" },
  });
  return NextResponse.json({ plugins: rows });
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  const body = addSchema.parse(await req.json());
  const row = await prisma.userPlugin.upsert({
    where: { userId_url: { userId, url: body.url } },
    create: { userId, url: body.url },
    update: { enabled: true },
  });
  return NextResponse.json({ plugin: row });
}
```

`apps/web/src/app/api/plugins/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/auth";

const patchSchema = z.object({ enabled: z.boolean() });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = await requireUserId();
  const body = patchSchema.parse(await req.json());
  const row = await prisma.userPlugin.update({
    where: { id: params.id, userId },
    data: { enabled: body.enabled },
  });
  return NextResponse.json({ plugin: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = await requireUserId();
  await prisma.userPlugin.delete({ where: { id: params.id, userId } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```
git add apps/web/src/app/api/plugins
git commit -m "feat(web): add plugin CRUD endpoints"
```

---

## Task 16: Plugin settings page

**Files:**
- Create: `apps/web/src/app/(app)/settings/plugins/page.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { useEffect, useState } from "react";

export default function PluginsSettingsPage() {
  const [list, setList] = useState<any[]>([]);
  const [url, setUrl] = useState("");

  async function reload() {
    const r = await fetch("/api/plugins");
    const { plugins } = await r.json();
    setList(plugins);
  }
  useEffect(() => { reload(); }, []);

  async function add() {
    await fetch("/api/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setUrl("");
    reload();
  }

  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/plugins/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    reload();
  }

  async function remove(id: string) {
    await fetch(`/api/plugins/${id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold">Plugins</h1>
      <div className="flex gap-2 mt-4">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://app.example.com/plugins/name.js"
          className="flex-1 rounded border px-2 py-1 bg-[var(--bg)]"
        />
        <button onClick={add} className="rounded border px-3 py-1">Add</button>
      </div>
      <ul className="mt-6 space-y-2">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={p.enabled}
              onChange={(e) => toggle(p.id, e.target.checked)}
            />
            <span className="flex-1 truncate">{p.url}</span>
            <button onClick={() => remove(p.id)} className="text-[var(--muted)]">Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```
git add apps/web/src/app/\(app\)/settings/plugins
git commit -m "feat(web): add plugin settings page"
```

---

## Task 17: Wire plugin loader into AppShell + StatusBar

**Files:**
- Create: `apps/web/src/components/StatusBar.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`

- [ ] **Step 1: StatusBar**

```tsx
"use client";
import { useSyncExternalStore } from "react";
import { pluginRegistry } from "@/lib/plugins/registry";

function subscribe(cb: () => void) {
  const id = setInterval(cb, 500);
  return () => clearInterval(id);
}
function snapshot() {
  return [...pluginRegistry.statusItems.values()];
}

export function StatusBar() {
  const items = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <div className="h-6 border-t border-[var(--border)] text-xs flex gap-4 px-3 items-center text-[var(--muted)]">
      {items.map(({ item }, i) => (
        <span key={i}>{item.render()}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: AppShell wiring**

In `AppShell.tsx` add a `useEffect` that runs once on mount:

```tsx
useEffect(() => {
  if (!session?.user || !activeVaultId) return;
  (async () => {
    const r = await fetch("/api/plugins");
    const { plugins } = await r.json();
    const allowList = (process.env.NEXT_PUBLIC_PLUGIN_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await loadPlugins({
      urls: plugins.filter((p: any) => p.enabled).map((p: any) => p.url),
      allowList,
      origin: window.location.origin,
      vaultId: activeVaultId,
      userId: session.user.id,
    });
  })();
}, [session?.user?.id, activeVaultId]);
```

Mount `<StatusBar />` at the bottom of the shell.

- [ ] **Step 3: Commit**

```
git add apps/web/src/components/StatusBar.tsx apps/web/src/components/AppShell.tsx
git commit -m "feat(web): load user plugins on app shell mount"
```

---

## Task 18: Command palette

**Files:**
- Create: `apps/web/src/components/CommandPalette.tsx`
- Modify: `apps/web/package.json` (add `cmdk`)
- Modify: `apps/web/src/components/AppShell.tsx`

- [ ] **Step 1: Install**

```
pnpm --filter @km/web add cmdk
```

- [ ] **Step 2: Implement**

```tsx
"use client";
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { pluginRegistry } from "@/lib/plugins/registry";
import { useActiveVault } from "@/hooks/useActiveVault";
import { useTheme } from "./ThemeProvider";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<any[]>([]);
  const router = useRouter();
  const vaultId = useActiveVault();
  const { toggle: toggleTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || !vaultId || query.length < 2) { setHits([]); return; }
    const h = setTimeout(async () => {
      const r = await fetch(`/api/search?vaultId=${vaultId}&q=${encodeURIComponent(query)}&limit=8`);
      const { results } = await r.json();
      setHits(results);
    }, 150);
    return () => clearTimeout(h);
  }, [open, query, vaultId]);

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette">
      <Command.Input value={query} onValueChange={setQuery} placeholder="Type a command or search..." />
      <Command.List>
        <Command.Group heading="Notes">
          {hits.map((h) => (
            <Command.Item key={h.id} onSelect={() => go(`/vault/${vaultId}/note/${h.id}`)}>
              {h.title}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Core">
          <Command.Item onSelect={() => go(`/vault/${vaultId}/graph`)}>Go to graph</Command.Item>
          <Command.Item onSelect={() => go(`/search`)}>Search notes</Command.Item>
          <Command.Item onSelect={() => { setOpen(false); toggleTheme(); }}>Toggle dark mode</Command.Item>
          <Command.Item onSelect={() => go("/api/auth/signout")}>Log out</Command.Item>
        </Command.Group>
        <Command.Group heading="Plugins">
          {[...pluginRegistry.commands.values()].map(({ item }) => (
            <Command.Item key={item.id} onSelect={() => { setOpen(false); item.run(); }}>
              {item.label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
```

Mount `<CommandPalette />` at the top of `AppShell.tsx`.

- [ ] **Step 3: Commit**

```
git add apps/web/src/components/CommandPalette.tsx apps/web/src/components/AppShell.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add Cmd+K command palette"
```

---

## Task 19: Dark mode CSS variables, ThemeProvider, and editor theme

**Files:**
- Create: `apps/web/src/styles/theme.css`
- Create: `apps/web/src/components/ThemeProvider.tsx`
- Create: `apps/web/src/components/ThemeToggle.tsx`
- Create: `packages/editor/src/theme.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `packages/editor/src/NoteEditor.tsx`
- Modify: `packages/editor/src/index.ts`

- [ ] **Step 1: Theme CSS**

```css
:root[data-theme="light"] {
  --bg: #ffffff; --fg: #111827; --muted: #6b7280;
  --border: #e5e7eb; --accent: #2563eb; --mark-bg: #fef3c7;
}
:root[data-theme="dark"] {
  --bg: #0b0f17; --fg: #e5e7eb; --muted: #9ca3af;
  --border: #1f2937; --accent: #60a5fa; --mark-bg: #78350f;
}
body { background: var(--bg); color: var(--fg); }
mark { background: var(--mark-bg); color: inherit; }
.cm-tag-pill {
  background: var(--mark-bg); border-radius: 4px; padding: 0 3px;
}
```

Import it in `layout.tsx`:

```tsx
import "@/styles/theme.css";
```

- [ ] **Step 2: Inline script to avoid flash**

In `app/layout.tsx`, inside `<head>`:

```tsx
<script dangerouslySetInnerHTML={{ __html: `
  (function(){
    try {
      var t = localStorage.getItem('km:theme');
      if (!t || t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
    } catch (e) {}
  })();
`}} />
```

- [ ] **Step 3: ThemeProvider**

```tsx
"use client";
import { createContext, useContext, useEffect, useState } from "react";

type Mode = "light" | "dark";
interface Ctx { mode: Mode; toggle: () => void }

const ThemeCtx = createContext<Ctx>({ mode: "light", toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as Mode) ?? "light";
    setMode(current);
  }, []);

  function toggle() {
    const next: Mode = mode === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("km:theme", next);
    setMode(next);
    fetch("/api/me/theme", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ themePreference: next }),
    }).catch(() => {});
  }

  return <ThemeCtx.Provider value={{ mode, toggle }}>{children}</ThemeCtx.Provider>;
}
```

- [ ] **Step 4: ThemeToggle**

```tsx
"use client";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return (
    <button onClick={toggle} className="rounded border px-2 py-1">
      {mode === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
```

- [ ] **Step 5: CM6 theme variant**

```ts
// packages/editor/src/theme.ts
import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";

export const lightTheme: Extension = EditorView.theme(
  {
    "&": { backgroundColor: "var(--bg)", color: "var(--fg)" },
    ".cm-content": { caretColor: "var(--fg)" },
    ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", border: "none" },
  },
  { dark: false },
);

export const darkTheme: Extension = EditorView.theme(
  {
    "&": { backgroundColor: "var(--bg)", color: "var(--fg)" },
    ".cm-content": { caretColor: "var(--fg)" },
    ".cm-gutters": { backgroundColor: "var(--bg)", color: "var(--muted)", border: "none" },
  },
  { dark: true },
);
```

In `NoteEditor.tsx` accept a `theme?: "light" | "dark"` prop and pick the extension accordingly. Re-export both from `packages/editor/src/index.ts`.

- [ ] **Step 6: /api/me/theme**

Add a PATCH route that updates `User.themePreference` for the current user. Return 204 on success.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "feat(web): dark mode with CSS vars and CM6 theme variant"
```

---

## Task 20: Example wordcount plugin

**Files:**
- Create: `examples/plugins/wordcount/package.json`
- Create: `examples/plugins/wordcount/tsup.config.ts`
- Create: `examples/plugins/wordcount/src/index.ts`
- Modify: `pnpm-workspace.yaml` (add `examples/plugins/*`)

- [ ] **Step 1: Package manifest**

```json
{
  "name": "@km-examples/wordcount",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsup src/index.ts --format esm --out-dir ../../../apps/web/public/plugins --entry-naming wordcount.js"
  },
  "dependencies": {
    "@km/shared": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: tsup config**

```ts
import { defineConfig } from "tsup";
export default defineConfig({
  format: ["esm"],
  dts: false,
  clean: false,
  external: ["@km/shared"],
});
```

- [ ] **Step 3: Plugin source**

```ts
import type { PluginDefinition } from "@km/shared";

export const plugin: PluginDefinition = {
  id: "wordcount",
  name: "Word count",
  version: "1.0.0",
  activate(ctx) {
    let count = 0;
    ctx.onNoteOpen(() => { count = 0; });
    ctx.onNoteSave((note) => {
      count = note.content.trim().split(/\s+/).filter(Boolean).length;
    });
    ctx.registerStatusBarItem({
      id: "wordcount:status",
      render: () => `${count} words`,
    });
  },
};
```

- [ ] **Step 4: Build**

```
pnpm --filter @km-examples/wordcount build
```

Expected: `apps/web/public/plugins/wordcount.js` written.

- [ ] **Step 5: Commit**

```
git add examples/plugins/wordcount apps/web/public/plugins/wordcount.js pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(examples): ship wordcount plugin"
```

---

## Task 21: E2E for search and tags

**Files:**
- Create: `apps/web/playwright/search-and-tags.spec.ts`

- [ ] **Step 1: Implement**

```ts
import { test, expect } from "@playwright/test";
import { signUp } from "./helpers";

test("search and tag flow", async ({ page }) => {
  await signUp(page);
  await page.click("text=New note");
  await page.fill("[aria-label='Note title']", "Alpha");
  await page.locator(".cm-content").fill("introductory text with #draft");
  await page.waitForTimeout(2000);

  await page.click("text=New note");
  await page.fill("[aria-label='Note title']", "Bravo");
  await page.locator(".cm-content").fill("a bravo note mentioning #draft");
  await page.waitForTimeout(2000);

  await page.keyboard.press("Control+K");
  await page.fill("[cmdk-input]", "bravo");
  await page.click("text=Bravo");
  await expect(page).toHaveURL(/note\//);

  await page.click("text=#draft");
  await expect(page.locator("text=Alpha")).toBeVisible();
  await expect(page.locator("text=Bravo")).toBeVisible();
});
```

- [ ] **Step 2: Run**

```
pnpm --filter @km/web exec playwright test search-and-tags
```

Expected: pass.

- [ ] **Step 3: Commit**

```
git add apps/web/playwright/search-and-tags.spec.ts
git commit -m "test(web): e2e for search palette and tag index"
```

---

## Task 22: E2E for graph

**Files:**
- Create: `apps/web/playwright/graph.spec.ts`

- [ ] **Step 1: Implement**

```ts
import { test, expect } from "@playwright/test";
import { signUp } from "./helpers";

test("graph renders nodes and edges", async ({ page }) => {
  await signUp(page);
  for (const title of ["A", "B", "C"]) {
    await page.click("text=New note");
    await page.fill("[aria-label='Note title']", title);
  }
  await page.locator("text=A").click();
  await page.locator(".cm-content").fill("links to [[B]] and [[C]]");
  await page.waitForTimeout(2000);

  await page.keyboard.press("Control+K");
  await page.fill("[cmdk-input]", "graph");
  await page.click("text=Go to graph");
  await page.waitForSelector("canvas");
  const count = await page.evaluate(() => document.querySelectorAll("canvas").length);
  expect(count).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run**

```
pnpm --filter @km/web exec playwright test graph
```

- [ ] **Step 3: Commit**

```
git add apps/web/playwright/graph.spec.ts
git commit -m "test(web): e2e smoke for graph page"
```

---

## Task 23: E2E for plugins

**Files:**
- Create: `apps/web/playwright/plugins.spec.ts`

- [ ] **Step 1: Implement**

```ts
import { test, expect } from "@playwright/test";
import { signUp } from "./helpers";

test("wordcount plugin updates status bar on save", async ({ page, baseURL }) => {
  await signUp(page);
  await page.goto(`${baseURL}/settings/plugins`);
  await page.fill("input[placeholder^='https']", `${baseURL}/plugins/wordcount.js`);
  await page.click("text=Add");
  await page.reload();

  await page.click("text=New note");
  await page.fill("[aria-label='Note title']", "P");
  await page.locator(".cm-content").fill("one two three four five");
  await page.waitForTimeout(2500);

  await expect(page.locator("text=5 words")).toBeVisible();
});
```

- [ ] **Step 2: Run**

```
pnpm --filter @km/web exec playwright test plugins
```

- [ ] **Step 3: Commit**

```
git add apps/web/playwright/plugins.spec.ts
git commit -m "test(web): e2e for plugin install and status bar"
```

---

## Task 24: Documentation and guides

**Files:**
- Create: `docs/plugins.md`
- Create: `guides/searching-and-tagging.md`
- Create: `guides/installing-plugins.md`
- Modify: `docs/architecture.md`
- Modify: `docs/data-model.md`

- [ ] **Step 1: docs/plugins.md**

Write a short document that:

1. Describes the `PluginDefinition` shape with code blocks copied from `packages/shared/src/plugins.ts`.
2. Explains the allow-list and how to set `NEXT_PUBLIC_PLUGIN_ALLOWLIST`.
3. Walks through the wordcount plugin as a worked example with build instructions.
4. Notes that v1 plugins run in the main window and lists what is out of scope (sandboxing, marketplace, hot reload).

- [ ] **Step 2: guides/searching-and-tagging.md**

Short user-facing guide covering: pressing `Cmd+K`, search operators (quoted phrases, `OR`, `-term`), tagging a note with `#foo`, clicking tags in the sidebar, and jumping to the graph view.

- [ ] **Step 3: guides/installing-plugins.md**

Short user-facing guide covering: opening settings, pasting a plugin URL, trusting same-origin plugins, disabling and removing plugins.

- [ ] **Step 4: Update architecture + data-model docs**

Add a "Polish" section to `docs/architecture.md` pointing at the spec, and document `Tag`, `NoteTag`, `UserPlugin`, and the `searchVector` generated column in `docs/data-model.md`.

- [ ] **Step 5: Commit**

```
git add docs guides
git commit -m "docs: phase 5 polish architecture, plugin guide, search/tags guide"
```

---

## Task 25: env example and final smoke

**Files:**
- Modify: `env.example`

- [ ] **Step 1: Add env var**

Append to `env.example`:

```
# Optional: comma-separated list of extra origins allowed to host plugin JS bundles.
# Same-origin plugins are always allowed. Example: https://cdn.example.com
NEXT_PUBLIC_PLUGIN_ALLOWLIST=
```

- [ ] **Step 2: Full test run**

```
pnpm -w turbo run lint typecheck test
pnpm --filter @km/web exec playwright test
```

Expected: everything green.

- [ ] **Step 3: Commit**

```
git add env.example
git commit -m "chore: document NEXT_PUBLIC_PLUGIN_ALLOWLIST"
```

---

## Self-review notes

- Spec coverage check: every numbered requirement in the spec maps to a task (tsvector + search: Tasks 1, 4, 5, 6; tags: 1, 2, 3, 7, 8, 9, 10; graph: 1, 11, 12; command palette: 18; plugin system: 1, 13, 14, 15, 16, 17, 20, 23; dark mode: 19; docs: 24; smoke and env: 25).
- Placeholder scan: every code step has actual code; no "TODO" strings.
- Type consistency: `PluginDefinition`, `PluginContext`, `Disposable`, `SearchHit`, `GraphNode`, `GraphEdge`, `TagMatch` are defined once and imported everywhere they are used. `recomputeLinksAndTags(tx, noteId, vaultId, markdown)` signature is identical in Task 3, Task 11 (via callers in snapshot), and the migration notes.
- `pluginRegistry` is a singleton instance used by both `StatusBar` (Task 17) and `CommandPalette` (Task 18), and registered-by `loader.ts` (Task 14) via `makePluginContext` (Task 14).
