# Phase 5 Polish: Search, Tags, Graph, Plugins

**Date:** 2026-04-13
**Status:** Approved design, ready for implementation planning
**Sub-project:** 5 of 5 (Polish)
**Builds on:** Foundation, Realtime (Phase 2), AI (Phase 3), Diagrams (Phase 4), all merged to `main`

## Context

Foundation delivered a single-user editor over a Postgres-backed vault; Phase 2 added realtime CRDT collaboration with a server-side snapshot pipeline; Phase 3 added the AI chat panel and inline commands; Phase 4 added drawio and bpmn-js diagram files. The core loop works, but day-to-day power users are missing the connective tissue that makes a knowledge base feel usable at scale: fast full-text search across notes, tags as a first-class organiser, a visual graph of the link structure, a keyboard-driven command palette, a dark theme, and an escape hatch for custom behaviour via plugins.

This document specifies the Polish sub-project. It is the final planned phase before the platform settles into maintenance.

## Goals

- Full-text search over note title and body with ranked snippets, vault-scoped, under 150 ms for a 10k-note vault.
- Tags parsed out of note content on save and stored in dedicated tables, queryable from the sidebar.
- Graph view page per vault, rendering all notes and their wiki-link edges with tag and search filters.
- Command palette (`Cmd+K` / `Ctrl+K`) available everywhere, fuzzy-matching notes, tags, core commands, and plugin commands.
- Minimal client-side plugin system with a typed contract, a URL-based loader with an allow-list, and a shipped example plugin.
- Dark mode across the whole app including the CodeMirror editor, driven by CSS variables and a user preference.

Out of scope for this phase:

- Server-side plugins, plugin marketplace, hot reload, signed plugins.
- Sandboxed iframe or worker isolation for plugins; v1 runs plugins in the main window on an allow-list of URLs.
- Search across attachment contents (PDF text extraction, OCR).
- Tag hierarchies (`#parent/child` is stored verbatim as a single tag in v1).
- Per-user saved searches or search history.
- Mobile-specific graph view gestures.

## Stack additions

| Concern | Choice |
|---|---|
| Full-text search | Postgres `tsvector` with `english` config, generated column on `Note`, GIN index |
| Search ranking | `ts_rank_cd` with `ts_headline` for snippets |
| Graph rendering | Cytoscape.js with `cytoscape-fcose` layout |
| Command palette | `cmdk` (Radix-flavoured command component) |
| Fuzzy matcher | `cmdk`'s built-in matcher, extended with a tiny scorer for plugin commands |
| Plugin transport | Dynamic `import()` from an allow-listed origin |
| Theme tokens | CSS custom properties on `:root` plus a CodeMirror theme variant |

`cytoscape-fcose` is chosen because it gives noticeably better clusters than `cose` and handles up to a few thousand nodes interactively in the browser. D3's force simulation was considered but requires us to hand-roll interaction (hover, zoom, click, selection highlighting), which Cytoscape gives for free. The price is a slightly heavier bundle (~250 kB gzip) which is lazy-loaded only on `/vault/[id]/graph`.

`cmdk` is preferred over building a palette from scratch because it handles keyboard navigation, accessibility, and grouped items out of the box.

## Data model changes

Three additions to `packages/db/prisma/schema.prisma`.

### Note: generated tsvector column

Prisma does not natively express Postgres generated columns, so we introduce the column via raw SQL in the migration and declare it as `Unsupported("tsvector")?` on the model so Prisma stays aware of it without trying to write to it.

```prisma
model Note {
  // ... existing fields

  searchVector Unsupported("tsvector")?

  @@index([searchVector], type: Gin)
}
```

Migration (raw SQL):

```sql
ALTER TABLE "Note"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("content", '')), 'B')
  ) STORED;

CREATE INDEX "Note_searchVector_idx" ON "Note" USING GIN ("searchVector");
```

The generated column recomputes automatically whenever `title` or `content` changes, so the snapshot pipeline (Phase 2) gets search updates for free without extra writes.

### Tag and NoteTag

```prisma
model Tag {
  id        String   @id @default(cuid())
  vaultId   String
  name      String
  createdAt DateTime @default(now())

  vault     Vault     @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  noteTags  NoteTag[]

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
```

Design notes:

- `Tag.name` stores the normalised form without the leading hash: `#Foo` and `#foo` both resolve to `Tag(name: "foo")` and are unique per vault.
- `NoteTag` is recomputed on every note save inside the same transaction as the `Link` recompute. The helper `recomputeLinks(tx, noteId, vaultId, markdown)` from Phase 2 becomes `recomputeLinksAndTags(tx, noteId, vaultId, markdown)` and absorbs the tag diff.
- No `Tag.color`. Colour is assigned deterministically from the tag name in the UI layer. If we later add user-assigned tag colours, it is an additive column change.

## Tag parsing

A new pure function in `packages/shared/src/parseTags.ts`:

```ts
export interface TagMatch {
  name: string;     // normalised, no leading #, no trailing punctuation
  start: number;    // byte offset of the # character
  end: number;      // byte offset just past the last tag character
}

export function parseTags(content: string): TagMatch[];
```

Rules:

- A tag is `#` followed by one or more of `[A-Za-z0-9_\-/]`. Slashes are allowed so users can write `#project/alpha` but tag storage treats the whole thing as a single flat name.
- Ignored inside fenced code blocks and inline code spans, using the same fence/backtick state machine as `parseWikiLinks`.
- Ignored if `#` is immediately preceded by an alphanumeric character (prevents URL fragments like `http://x/page#section` from being parsed as a tag).
- Ignored if the character run after `#` is only digits (prevents `#123` from being a tag, a heuristic match for issue numbers and headings).
- Normalisation: lowercase, collapse internal whitespace to nothing (tags do not contain spaces by the character class above), strip trailing `-` or `/`.

Tests live in `packages/shared/src/parseTags.test.ts` and mirror the coverage shape of `parseWikiLinks.test.ts`.

## Search pipeline and API

### Query execution

A new helper `apps/web/src/lib/search.ts` exports `searchNotes({ vaultId, query, limit })`:

1. Build a `websearch_to_tsquery('english', $1)` from the raw user input. `websearch_to_tsquery` handles quoted phrases, `OR`, and negation without us writing a parser.
2. Execute a parameterised raw query via `prisma.$queryRaw`:
   ```sql
   SELECT
     n.id, n.title, n."updatedAt",
     ts_rank_cd(n."searchVector", q) AS rank,
     ts_headline('english', n.content, q,
       'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=14, MinWords=4') AS snippet
   FROM "Note" n, websearch_to_tsquery('english', $1) q
   WHERE n."vaultId" = $2 AND n."searchVector" @@ q
   ORDER BY rank DESC, n."updatedAt" DESC
   LIMIT $3;
   ```
3. Sanitise the snippet server-side before returning: the only tags allowed through are `<mark>` and `</mark>`; everything else is escaped. The client renders with `dangerouslySetInnerHTML` only after this pass.

### API surface

```
GET /api/search?vaultId=<id>&q=<string>&limit=50
  → { results: Array<{ id, title, snippet, rank, updatedAt }> }
```

- `assertCanAccessVault(userId, vaultId, "MEMBER")` at the top of the handler.
- `q` shorter than 2 characters returns an empty array without hitting Postgres.
- The existing title-only `GET /api/notes/search` endpoint is deleted; wiki-link autocomplete moves to a new internal helper backed by the same `tsvector` index but without snippets (see `apps/web/src/lib/noteAutocomplete.ts`).

### UI

- `apps/web/src/app/(app)/search/page.tsx`: a full-page search UI bound to `?q=` in the URL. Uses a `useDebouncedValue` hook with a 200 ms delay and renders a list of `{ title, snippet, updatedAt }` cards. Clicking navigates to the note.
- The command palette also triggers `searchNotes` for its inline results (see below) but with `limit=8`.

## Tags UI

- `apps/web/src/components/TagsSidebar.tsx`: mounted beneath the file tree in the vault shell. Lists all tags in the current vault with a note count, sorted by count descending then name. Clicking a tag navigates to `/vault/[id]/tags/[name]`.
- `apps/web/src/app/(app)/vault/[vaultId]/tags/[name]/page.tsx`: lists every note in the vault carrying that tag. No snippets; this is a pure index.
- `GET /api/vaults/:vaultId/tags` returns `{ tags: Array<{ name, count }> }` for the sidebar, cached with `next: { revalidate: 0 }` but served through React Query in the client so it updates after a save.
- Tags inside the editor are decorated by a new CodeMirror extension `packages/editor/src/tagHighlight.ts`: `#tag` tokens render with a themed background pill. Click opens the tag index page.

## Graph view

### Page

`apps/web/src/app/(app)/vault/[vaultId]/graph/page.tsx` is a dynamic `client: "only"` page because Cytoscape requires `window`. The page:

1. Fetches `GET /api/vaults/:vaultId/graph` which returns `{ nodes, edges }`:
   ```ts
   type GraphNode = {
     id: string;          // noteId
     label: string;       // title
     backlinkCount: number;
     tags: string[];
   };
   type GraphEdge = {
     id: string;          // linkId
     source: string;      // noteId
     target: string;      // noteId
   };
   ```
2. Builds a Cytoscape instance with `fcose` layout, node size `10 + sqrt(backlinkCount) * 6`, edge opacity 0.4.
3. Mounts toolbar components: a text filter (substring match on label), a tag filter (multi-select over distinct tags), and a "reset layout" button.
4. Filtering hides nodes with `display: none` style rather than removing them from the graph so the layout remains stable.
5. Clicking a node calls `router.push('/vault/[vaultId]/note/[noteId]')`.

### Backend

`apps/web/src/lib/graph.ts` exports `buildGraph(vaultId)`:

- One query for notes: `SELECT id, title FROM "Note" WHERE "vaultId" = $1`.
- One query for resolved links in the vault: `SELECT id, "sourceNoteId", "targetNoteId" FROM "Link" WHERE "resolved" = true AND "sourceNoteId" IN (...)`.
- One query for tag membership: `SELECT "noteId", t.name FROM "NoteTag" nt JOIN "Tag" t ON nt."tagId" = t.id WHERE t."vaultId" = $1`.
- Backlink counts computed in JS by tallying `targetNoteId` occurrences.

At 10k notes the endpoint returns roughly 1 MB of JSON uncompressed, roughly 200 kB gzipped. Acceptable for an on-demand page. If it becomes a problem later we can paginate by folder or cluster.

## Command palette

`apps/web/src/components/CommandPalette.tsx` is mounted once in the app shell. It listens for `Cmd+K`/`Ctrl+K` globally and opens a `cmdk` dialog with the following grouped item sources:

- **Notes** (live): debounced 150 ms, calls `searchNotes({ limit: 8 })`.
- **Tags** (live): filters the cached vault tags list.
- **Recent** (local): last 10 notes opened, stored in `localStorage` keyed by `km:recent:<vaultId>`.
- **Core commands** (static):
  - `New note`
  - `New folder`
  - `Export vault`
  - `Go to graph`
  - `Toggle dark mode`
  - `Log out`
- **Plugin commands** (dynamic): whatever active plugins have registered via `registerCommand`.

Each item has `id`, `label`, `group`, `run()`. The palette calls `run()` and closes on selection.

## Plugin system

### Contract

A plugin is an ES module exported from a URL. It must export a `plugin: PluginDefinition` object conforming to:

```ts
// packages/shared/src/plugins.ts

export interface PluginContext {
  registerCommand(cmd: {
    id: string;              // namespaced, e.g. "wordcount:show"
    label: string;
    group?: string;          // default "Plugin"
    run: () => void | Promise<void>;
  }): Disposable;

  registerStatusBarItem(item: {
    id: string;
    render: () => ReactNode;
  }): Disposable;

  registerEditorExtension(extension: Extension): Disposable;

  onNoteOpen(handler: (note: { id: string; title: string }) => void): Disposable;
  onNoteSave(handler: (note: { id: string; title: string; content: string }) => void): Disposable;

  readonly vaultId: string;
  readonly userId: string;
}

export interface PluginDefinition {
  id: string;                // globally unique, e.g. "wordcount"
  name: string;              // display name
  version: string;           // semver
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export type Disposable = { dispose: () => void };
```

The `Extension` type is the CodeMirror 6 `Extension` type re-exported from `@km/editor`. Plugins that touch the editor depend on `@km/editor` as an external.

### Loader

`apps/web/src/lib/plugins/loader.ts` exports `loadPlugins(urls: string[]): Promise<LoadedPlugin[]>`:

1. For each URL, check against an allow-list. The allow-list is the union of:
   - Same-origin as `window.location.origin`.
   - Entries in the env var `NEXT_PUBLIC_PLUGIN_ALLOWLIST` (comma-separated).
2. `const mod = await import(/* @vite-ignore */ url)`. If it throws or does not export `plugin`, record the error and skip.
3. Validate the shape against `pluginDefinitionSchema` (zod) from `@km/shared`.
4. Instantiate a `PluginContext` bound to the current vault and user; call `plugin.activate(ctx)`.
5. Track all `Disposable`s returned from `register*` hooks so `deactivate()` can clean them up on unload.

### Per-user plugin list

A new Prisma model:

```prisma
model UserPlugin {
  id        String   @id @default(cuid())
  userId    String
  url       String
  enabled   Boolean  @default(true)
  installedAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, url])
  @@index([userId])
}
```

Settings page `/settings/plugins` lists installed plugins, lets the user add a URL, toggle enabled, and remove. API:

```
GET    /api/plugins              → list current user's plugins
POST   /api/plugins              → { url } adds if allow-listed
PATCH  /api/plugins/:id          → { enabled }
DELETE /api/plugins/:id
```

On app load, `AppShell` calls `GET /api/plugins`, filters to `enabled = true`, and passes URLs to `loadPlugins`.

### Sandboxing note

v1 loads plugins into the main window. This is deliberate: the allow-list is narrow (same-origin by default), plugins are opt-in per user, and the status bar / palette surfaces are low-privilege compared to server-side code execution. A future phase may move plugins into a sandboxed iframe with a `postMessage` bridge modelled on the VS Code extension host; the `PluginContext` interface is designed so its implementation can be swapped to a `postMessage` proxy without plugin-code changes.

### Example plugin

`examples/plugins/wordcount/src/index.ts` is a small plugin shipped in the repo:

```ts
import type { PluginDefinition } from "@km/shared";

export const plugin: PluginDefinition = {
  id: "wordcount",
  name: "Word count",
  version: "1.0.0",
  activate(ctx) {
    let count = 0;
    const disposeSave = ctx.onNoteSave((note) => {
      count = note.content.trim().split(/\s+/).filter(Boolean).length;
    });
    const disposeStatus = ctx.registerStatusBarItem({
      id: "wordcount:status",
      render: () => `${count} words`,
    });
    ctx.onNoteOpen(() => {
      count = 0;
    });
    return () => {
      disposeSave.dispose();
      disposeStatus.dispose();
    };
  },
};
```

It is built with `tsup` to a single file, served from `apps/web/public/plugins/wordcount.js` so it is same-origin and automatically allow-listed.

## Dark mode

A pair of CSS custom property palettes is defined in `apps/web/src/styles/theme.css`:

```css
:root[data-theme="light"] {
  --bg: #ffffff;
  --fg: #111827;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #2563eb;
  --mark-bg: #fef3c7;
}
:root[data-theme="dark"] {
  --bg: #0b0f17;
  --fg: #e5e7eb;
  --muted: #9ca3af;
  --border: #1f2937;
  --accent: #60a5fa;
  --mark-bg: #78350f;
}
```

- `apps/web/src/components/ThemeProvider.tsx` reads/writes `localStorage["km:theme"]` and applies `data-theme` to `document.documentElement`. The initial value is set from a tiny inline script in `layout.tsx` before first paint to avoid a flash.
- User setting is stored server-side on `User.themePreference` ("light" | "dark" | "system") and synced when the user is signed in, so the preference follows them across devices.
- `packages/editor/src/theme.ts` exports `lightTheme` and `darkTheme` CodeMirror `Extension`s. `NoteEditor` picks between them based on a `theme` prop passed by the page.
- `ToggleDarkMode` is one of the static palette commands.

## Deployment

- No new services. All changes are inside `apps/web` and `packages/*`, plus the new `examples/plugins/wordcount` package and its build output under `apps/web/public/plugins/`.
- One Prisma migration `phase5_polish` covers tsvector + `Tag` + `NoteTag` + `UserPlugin`.
- `NEXT_PUBLIC_PLUGIN_ALLOWLIST` added to `env.example` with a comment explaining the format.
- Cloudflare proxy settings unchanged; plugin loads are same-origin by default so no new allow-lists are required there.

## Testing

- **Unit (Vitest):**
  - `packages/shared/src/parseTags.test.ts` covers normalisation, code-fence exclusion, URL-fragment heuristic, numeric-only tags, `#project/alpha` form.
  - `apps/web/src/lib/search.test.ts` covers empty query, short query, quoted phrase, snippet sanitisation.
  - `apps/web/src/lib/graph.test.ts` covers backlink counts, tag attachment, empty vault.
  - `apps/web/src/lib/plugins/loader.test.ts` covers allow-list enforcement, schema validation, disposable cleanup on deactivate.
- **Integration (Vitest + real Postgres):**
  - `apps/web/src/app/api/search/route.test.ts` creates notes, runs `GET /api/search`, asserts rank ordering and snippet content.
  - `apps/web/src/lib/recomputeLinksAndTags.test.ts` asserts tag diff on save (add, remove, rename).
  - Realtime snapshot test is updated to assert tags persist after a CRDT-driven snapshot.
- **E2E (Playwright):**
  - `apps/web/playwright/search-and-tags.spec.ts`: create two notes, add `#draft` and `#published`, open `Cmd+K`, search a unique phrase, click result, navigate to tag page.
  - `apps/web/playwright/graph.spec.ts`: create three notes with wiki-links, open graph page, assert three nodes render.
  - `apps/web/playwright/plugins.spec.ts`: install the shipped `wordcount` plugin by URL, open a note, type text, assert the status bar updates.

## Documentation and guides

- `docs/architecture.md` adds a "Search, tags, graph, plugins" section pointing at this spec.
- `docs/data-model.md` documents the new tables and the tsvector column.
- `docs/plugins.md` is new: explains the plugin contract, allow-list model, and bundling expectations, with the wordcount plugin as a worked example.
- `guides/searching-and-tagging.md` is new: user-facing walkthrough of Cmd+K, search syntax, tagging notes, and using the graph view.
- `guides/installing-plugins.md` is new: how to add a plugin URL, safety considerations, uninstalling.

## Open items deferred to implementation

- Exact bundle size budget for the graph page and whether the Cytoscape layout ships async (`next/dynamic`) or is chunk-split.
- Whether `ts_headline` output quality is acceptable without a domain-specific dictionary, or whether we need a secondary snippet pass using `computeSnippet` from `@km/shared` as a fallback for very long notes.
- Colour scale for tag pills in light vs dark theme.
- Whether `UserPlugin.url` should validate as `https:` at write time or at load time. Implementation can choose the stricter of the two that does not break local dev against `http://localhost:3000`.
