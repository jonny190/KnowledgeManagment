# Plan C: Editor, Wiki-Links, Backlinks, Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Plan B plain-textarea note editor with a CodeMirror 6 editor that supports wiki-link tokenisation, click-to-navigate, autocomplete, live preview decorations, server-side link recomputation, a backlinks panel with snippets, and drag-and-drop attachment uploads.

**Architecture:** A new `packages/editor` package wraps CodeMirror 6 and ships a React component consumed by `apps/web`. A pure `parseWikiLinks` function lives in `packages/shared` and is used both by the editor for client-side hints and by the `PATCH /api/notes/:id` handler to rebuild `Link` rows in the same transaction as the note update. Attachments are stored on disk under `${DATA_DIR}/vaults/<vaultId>/attachments/` with metadata in Postgres and streamed back through an authorised route handler.

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/language`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@lezer/common`), React 18, Next.js App Router, Prisma, Vitest, Playwright, `formidable` or native `Request.formData()` for multipart, Node `fs/promises` and `stream` for file IO.

---

## Assumptions

Plan A delivered the monorepo scaffold, Prisma schema (including `Note`, `Link`, `Attachment`), NextAuth with Credentials + Google + GitHub, and the `${DATA_DIR}` env var.

Plan B delivered:

- `apps/web/src/lib/auth/assertCanAccessVault.ts` exporting `assertCanAccessVault(userId: string, vaultId: string, requiredRole?: 'OWNER' | 'ADMIN' | 'MEMBER'): Promise<{ membership: Membership | null; vault: Vault }>` that throws `ForbiddenError` when access is denied.
- `GET /api/vaults/:id/tree`, `POST /api/folders`, `PATCH /api/folders/:id`, `DELETE /api/folders/:id`.
- `GET /api/notes/:id`, `POST /api/notes`, `PATCH /api/notes/:id` (updates `content`, `updatedAt`, `updatedById` but does NOT yet touch `Link` rows), `DELETE /api/notes/:id`, `GET /api/notes/search?q=&vaultId=` (title prefix search).
- `GET /api/notes/:id/backlinks` returning `{ backlinks: [] }` as a stub because `Link` rows are never written.
- A `apps/web/src/app/(app)/notes/[id]/page.tsx` route rendering a plain `<textarea>` bound to the note content with a 1.5s debounced autosave calling `PATCH /api/notes/:id`.
- `apps/web/src/lib/autosave.ts` exporting `useDebouncedAutosave<T>(value: T, delayMs: number, save: (v: T) => Promise<void>): { saving: boolean; lastSavedAt: Date | null }`.
- `GET /api/vaults/:id/tree` response shape `{ folders: Folder[]; notes: { id: string; title: string; folderId: string | null }[] }`.
- `GET /api/notes/search?q=&vaultId=` response shape `{ results: { id: string; title: string }[] }`.
- `POST /api/notes` accepts `{ vaultId, title, content, folderId? }` and responds `{ note: { id, vaultId, title, content } }`.
- `apps/web/src/lib/auth/options.ts` exporting `authOptions` and a NextAuth session augmented with `session.user.id`.
- Test helpers from Plan B at `apps/web/tests/integration/helpers/auth.ts` exporting `createUserWithVault(email: string): Promise<{ userId: string; vaultId: string }>` and `sessionForUser(userId: string)`, plus `apps/web/tests/integration/helpers/request.ts` exporting `withSession(session, fn)` which patches `getServerSession` for the duration of `fn`.
- Playwright helper at `apps/web/tests/e2e/helpers/auth.ts` exporting `signUpAndLogin(page, email, password)`, and the file-tree UI exposing `data-testid` values `file-tree`, `new-note-button`, `new-note-title`, `new-note-submit`.
- `tsconfig.base.json` at the repo root with strict mode and `paths` mapping `@/*` to `apps/web/src/*` inside `apps/web/tsconfig.json`.
- Vitest, Playwright, and a `pnpm test:integration` script that boots a test Postgres via `docker compose -f docker-compose.test.yml up -d` and runs Prisma migrations.

---

## File Structure

**Create:**

- `packages/shared/src/parseWikiLinks.ts`
- `packages/shared/src/parseWikiLinks.test.ts`
- `packages/shared/src/computeSnippet.ts`
- `packages/shared/src/computeSnippet.test.ts`
- `packages/editor/package.json`
- `packages/editor/tsconfig.json`
- `packages/editor/src/index.ts`
- `packages/editor/src/theme.ts`
- `packages/editor/src/wikiLinkField.ts`
- `packages/editor/src/wikiLinkExtension.ts`
- `packages/editor/src/wikiLinkAutocomplete.ts`
- `packages/editor/src/livePreview.ts`
- `packages/editor/src/NoteEditor.tsx`
- `packages/editor/src/wikiLinkField.test.ts`
- `packages/editor/src/wikiLinkAutocomplete.test.ts`
- `apps/web/src/lib/attachments.ts`
- `apps/web/src/app/api/attachments/route.ts`
- `apps/web/src/app/api/attachments/[id]/route.ts`
- `apps/web/src/components/BacklinksPanel.tsx`
- `apps/web/src/components/CreateNoteDialog.tsx`
- `apps/web/tests/integration/link-recompute.test.ts`
- `apps/web/tests/integration/attachments.test.ts`
- `apps/web/tests/integration/backlinks-snippets.test.ts`
- `apps/web/tests/e2e/wiki-links.spec.ts`

**Modify:**

- `packages/shared/src/index.ts` (add exports)
- `packages/shared/package.json` (no new deps; confirm build script)
- `pnpm-workspace.yaml` (already covers `packages/*`; verify only)
- `apps/web/package.json` (add `@km/editor` workspace dep)
- `apps/web/src/app/api/notes/[id]/route.ts` (transactional link recomputation on PATCH)
- `apps/web/src/app/api/notes/[id]/backlinks/route.ts` (return real backlinks with snippets)
- `apps/web/src/app/(app)/notes/[id]/page.tsx` (swap textarea for `NoteEditor`, add backlinks panel, wire drag-drop)

---

## Task 1: parseWikiLinks pure function in packages/shared

**Files:**
- Create: `packages/shared/src/parseWikiLinks.ts`
- Create: `packages/shared/src/parseWikiLinks.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests for parseWikiLinks**

Create `packages/shared/src/parseWikiLinks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseWikiLinks } from './parseWikiLinks';

describe('parseWikiLinks', () => {
  it('returns empty array for empty content', () => {
    expect(parseWikiLinks('')).toEqual([]);
  });

  it('parses a single wiki-link', () => {
    expect(parseWikiLinks('see [[Alpha]] now')).toEqual([
      { title: 'Alpha', start: 4, end: 13 },
    ]);
  });

  it('parses wiki-link with alias', () => {
    expect(parseWikiLinks('see [[Alpha|the first]] here')).toEqual([
      { title: 'Alpha', alias: 'the first', start: 4, end: 23 },
    ]);
  });

  it('parses multiple links on one line', () => {
    const r = parseWikiLinks('[[A]] and [[B|b]]');
    expect(r.map((l) => ({ title: l.title, alias: l.alias }))).toEqual([
      { title: 'A', alias: undefined },
      { title: 'B', alias: 'b' },
    ]);
  });

  it('trims internal whitespace in title and alias', () => {
    expect(parseWikiLinks('[[  Alpha  |  alias text  ]]')[0]).toMatchObject({
      title: 'Alpha',
      alias: 'alias text',
    });
  });

  it('ignores links inside fenced code blocks', () => {
    const src = 'before\n```\n[[NotALink]]\n```\nafter [[Real]]';
    const r = parseWikiLinks(src);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Real');
  });

  it('ignores links inside tilde fenced code blocks', () => {
    const src = '~~~\n[[Nope]]\n~~~\n[[Yes]]';
    expect(parseWikiLinks(src).map((l) => l.title)).toEqual(['Yes']);
  });

  it('ignores links inside inline code spans', () => {
    const src = 'text `[[NotALink]]` [[Real]]';
    expect(parseWikiLinks(src).map((l) => l.title)).toEqual(['Real']);
  });

  it('respects escaped opening brackets', () => {
    expect(parseWikiLinks('escaped \\[[NotALink]] done')).toEqual([]);
  });

  it('skips malformed unterminated links', () => {
    expect(parseWikiLinks('open [[Alpha and nothing else')).toEqual([]);
  });

  it('skips empty titles', () => {
    expect(parseWikiLinks('[[]] and [[|a]]')).toEqual([]);
  });

  it('does not cross newlines inside a link', () => {
    expect(parseWikiLinks('[[Alpha\nBeta]]')).toEqual([]);
  });

  it('handles adjacent links without whitespace', () => {
    expect(parseWikiLinks('[[A]][[B]]').map((l) => l.title)).toEqual(['A', 'B']);
  });

  it('ignores a bare pipe with no title', () => {
    expect(parseWikiLinks('[[|only alias]]')).toEqual([]);
  });

  it('de-duplicates by title+alias preserving first occurrence offsets', () => {
    const r = parseWikiLinks('[[A]] [[A]] [[A|x]]');
    expect(r).toHaveLength(3);
    expect(r[0].start).toBe(0);
  });

  it('does not treat a single opening [ as a link', () => {
    expect(parseWikiLinks('[Alpha]')).toEqual([]);
  });

  it('handles tildes with fewer than three as not a fence', () => {
    expect(parseWikiLinks('~~\n[[Alpha]]\n~~')[0].title).toBe('Alpha');
  });

  it('reopens parsing after a closing fence', () => {
    const src = '```\n[[A]]\n```\n[[B]]\n```\n[[C]]\n```';
    expect(parseWikiLinks(src).map((l) => l.title)).toEqual(['B']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter @km/shared test parseWikiLinks`
Expected: FAIL with `Cannot find module './parseWikiLinks'`.

- [ ] **Step 3: Implement parseWikiLinks**

Create `packages/shared/src/parseWikiLinks.ts`:

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm --filter @km/shared test parseWikiLinks`
Expected: PASS, 17 tests green.

- [ ] **Step 5: Export from package index**

Modify `packages/shared/src/index.ts`, append:

```ts
export { parseWikiLinks } from './parseWikiLinks';
export type { WikiLinkMatch } from './parseWikiLinks';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/parseWikiLinks.ts packages/shared/src/parseWikiLinks.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add parseWikiLinks pure utility with fence and inline-code awareness"
```

---

## Task 2: computeSnippet pure function in packages/shared

**Files:**
- Create: `packages/shared/src/computeSnippet.ts`
- Create: `packages/shared/src/computeSnippet.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests for computeSnippet**

Create `packages/shared/src/computeSnippet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeSnippet } from './computeSnippet';

describe('computeSnippet', () => {
  it('returns empty string when no match', () => {
    expect(computeSnippet('hello world', 'Missing')).toBe('');
  });

  it('returns the whole content when short enough', () => {
    expect(computeSnippet('short [[Alpha]] content', 'Alpha')).toBe('short [[Alpha]] content');
  });

  it('centres the match with an ellipsis on both sides when long', () => {
    const pad = 'x'.repeat(200);
    const src = `${pad} [[Alpha]] ${pad}`;
    const s = computeSnippet(src, 'Alpha');
    expect(s.startsWith('...')).toBe(true);
    expect(s.endsWith('...')).toBe(true);
    expect(s).toContain('[[Alpha]]');
    expect(s.length).toBeLessThanOrEqual(120 + 6);
  });

  it('matches alias form [[Title|alias]]', () => {
    const pad = 'y'.repeat(200);
    const src = `${pad} [[Alpha|shown]] ${pad}`;
    const s = computeSnippet(src, 'Alpha');
    expect(s).toContain('[[Alpha|shown]]');
  });

  it('does not add leading ellipsis when near start', () => {
    const src = `[[Alpha]] ${'z'.repeat(200)}`;
    const s = computeSnippet(src, 'Alpha');
    expect(s.startsWith('...')).toBe(false);
    expect(s.endsWith('...')).toBe(true);
  });

  it('is case sensitive on the title', () => {
    expect(computeSnippet('[[Alpha]]', 'alpha')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter @km/shared test computeSnippet`
Expected: FAIL with `Cannot find module './computeSnippet'`.

- [ ] **Step 3: Implement computeSnippet**

Create `packages/shared/src/computeSnippet.ts`:

```ts
const CONTEXT = 60;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function computeSnippet(content: string, title: string): string {
  const re = new RegExp(`\\[\\[${escapeRegex(title)}(\\|[^\\]]*)?\\]\\]`);
  const m = content.match(re);
  if (!m || m.index === undefined) return '';

  const start = m.index;
  const end = start + m[0].length;
  const from = Math.max(0, start - CONTEXT);
  const to = Math.min(content.length, end + CONTEXT);

  const prefix = from > 0 ? '...' : '';
  const suffix = to < content.length ? '...' : '';
  return `${prefix}${content.slice(from, to)}${suffix}`;
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm --filter @km/shared test computeSnippet`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Export from package index**

Modify `packages/shared/src/index.ts`, append:

```ts
export { computeSnippet } from './computeSnippet';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/computeSnippet.ts packages/shared/src/computeSnippet.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add computeSnippet utility for backlink previews"
```

---

## Task 3: Scaffold packages/editor workspace package

**Files:**
- Create: `packages/editor/package.json`
- Create: `packages/editor/tsconfig.json`
- Create: `packages/editor/src/index.ts`

- [ ] **Step 1: Create package.json**

Create `packages/editor/package.json`:

```json
{
  "name": "@km/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@codemirror/autocomplete": "^6.18.0",
    "@codemirror/commands": "^6.6.0",
    "@codemirror/lang-markdown": "^6.3.0",
    "@codemirror/language": "^6.10.0",
    "@codemirror/state": "^6.4.1",
    "@codemirror/view": "^6.30.0",
    "@lezer/common": "^1.2.1",
    "@lezer/markdown": "^1.3.0",
    "@km/shared": "workspace:*"
  },
  "peerDependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/editor/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create index stub**

Create `packages/editor/src/index.ts`:

```ts
export {};
```

- [ ] **Step 4: Install and verify package resolves**

Run from repo root:

```bash
pnpm install
pnpm --filter @km/editor build
```

Expected: install completes, build logs `tsc -p tsconfig.json --noEmit` with exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/package.json packages/editor/tsconfig.json packages/editor/src/index.ts pnpm-lock.yaml
git commit -m "feat(editor): scaffold @km/editor package with CodeMirror 6 dependencies"
```

---

## Task 4: Base editor theme

**Files:**
- Create: `packages/editor/src/theme.ts`

- [ ] **Step 1: Write theme**

Create `packages/editor/src/theme.ts`:

```ts
import { EditorView } from '@codemirror/view';

export const baseTheme = EditorView.theme({
  '&': {
    fontSize: '15px',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    backgroundColor: '#ffffff',
    color: '#1f2328',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: '16px',
    caretColor: '#0969da',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-wiki-link': {
    color: '#0969da',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
  },
  '.cm-wiki-link-unresolved': {
    color: '#cf222e',
    textDecorationColor: '#cf222e',
  },
  '.cm-wiki-link:hover': {
    backgroundColor: '#ddf4ff',
  },
  '.cm-heading-1': { fontSize: '1.5em', fontWeight: '600' },
  '.cm-heading-2': { fontSize: '1.3em', fontWeight: '600' },
  '.cm-heading-3': { fontSize: '1.15em', fontWeight: '600' },
  '.cm-strong': { fontWeight: '700' },
  '.cm-emphasis': { fontStyle: 'italic' },
  '.cm-inline-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    backgroundColor: '#f6f8fa',
    padding: '0 3px',
    borderRadius: '3px',
  },
  '.cm-code-block': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    backgroundColor: '#f6f8fa',
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/editor/src/theme.ts
git commit -m "feat(editor): add base CodeMirror theme"
```

---

## Task 5: Wiki-link state field (tokenisation only)

**Files:**
- Create: `packages/editor/src/wikiLinkField.ts`
- Create: `packages/editor/src/wikiLinkField.test.ts`

- [ ] **Step 1: Write failing test for the state field**

Create `packages/editor/src/wikiLinkField.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { wikiLinkField, getWikiLinks } from './wikiLinkField';

function stateOf(doc: string) {
  return EditorState.create({ doc, extensions: [wikiLinkField] });
}

describe('wikiLinkField', () => {
  it('returns no links for plain text', () => {
    expect(getWikiLinks(stateOf('hello world'))).toEqual([]);
  });

  it('finds a single link with its range', () => {
    const s = stateOf('see [[Alpha]] there');
    const links = getWikiLinks(s);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ title: 'Alpha', from: 4, to: 13 });
  });

  it('finds a link with alias', () => {
    const links = getWikiLinks(stateOf('[[Alpha|a]]'));
    expect(links[0]).toMatchObject({ title: 'Alpha', alias: 'a', from: 0, to: 11 });
  });

  it('ignores links inside code fences', () => {
    const s = stateOf('```\n[[Ignore]]\n```\n[[Keep]]');
    const titles = getWikiLinks(s).map((l) => l.title);
    expect(titles).toEqual(['Keep']);
  });

  it('updates when the document changes', () => {
    let s = stateOf('hello');
    s = s.update({ changes: { from: 5, insert: ' [[New]]' } }).state;
    expect(getWikiLinks(s).map((l) => l.title)).toEqual(['New']);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter @km/editor test wikiLinkField`
Expected: FAIL with `Cannot find module './wikiLinkField'`.

- [ ] **Step 3: Implement the state field**

Create `packages/editor/src/wikiLinkField.ts`:

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm --filter @km/editor test wikiLinkField`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/wikiLinkField.ts packages/editor/src/wikiLinkField.test.ts
git commit -m "feat(editor): add wiki-link state field tracking titles and ranges"
```

---

## Task 6: Wiki-link decorations and click handler

**Files:**
- Create: `packages/editor/src/wikiLinkExtension.ts`

- [ ] **Step 1: Implement the view plugin and click handler**

Create `packages/editor/src/wikiLinkExtension.ts`:

```ts
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
          if (u.docChanged || u.viewportChanged) {
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
  eq(other: WikiLinkWidget) {
    return other.title === this.title;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-wiki-link';
    span.textContent = this.title;
    return span;
  }
}
```

- [ ] **Step 2: Typecheck the package**

Run: `pnpm --filter @km/editor build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/wikiLinkExtension.ts
git commit -m "feat(editor): decorate wiki-links and wire cmd/ctrl-click navigation"
```

---

## Task 7: Wiki-link autocomplete triggered on [[

**Files:**
- Create: `packages/editor/src/wikiLinkAutocomplete.ts`
- Create: `packages/editor/src/wikiLinkAutocomplete.test.ts`

- [ ] **Step 1: Write failing tests for the source function**

Create `packages/editor/src/wikiLinkAutocomplete.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { buildWikiLinkSource } from './wikiLinkAutocomplete';

function ctxAt(doc: string, pos: number, explicit = false) {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, explicit);
}

describe('buildWikiLinkSource', () => {
  it('returns null when not after [[', async () => {
    const src = buildWikiLinkSource({ search: vi.fn() });
    const result = await src(ctxAt('hello', 5));
    expect(result).toBeNull();
  });

  it('triggers on [[ with empty query', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 'n1', title: 'Alpha' }]);
    const src = buildWikiLinkSource({ search });
    const result = await src(ctxAt('[[', 2));
    expect(search).toHaveBeenCalledWith('');
    expect(result?.options[0].label).toBe('Alpha');
  });

  it('passes the current partial query', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 'n1', title: 'Alphabet' }]);
    const src = buildWikiLinkSource({ search });
    await src(ctxAt('see [[Alp', 9));
    expect(search).toHaveBeenCalledWith('Alp');
  });

  it('does not trigger if a closing ]] already appears before the cursor on the same line', async () => {
    const src = buildWikiLinkSource({ search: vi.fn() });
    const result = await src(ctxAt('[[Alpha]] more', 14));
    expect(result).toBeNull();
  });

  it('emits options whose apply replaces the open-bracket region with title]]', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 'n1', title: 'Alpha' }]);
    const src = buildWikiLinkSource({ search });
    const result = await src(ctxAt('[[Al', 4));
    expect(result?.from).toBe(2);
    expect(result?.options[0].apply).toBe('Alpha]] ');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter @km/editor test wikiLinkAutocomplete`
Expected: FAIL with `Cannot find module './wikiLinkAutocomplete'`.

- [ ] **Step 3: Implement the autocomplete source**

Create `packages/editor/src/wikiLinkAutocomplete.ts`:

```ts
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
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm --filter @km/editor test wikiLinkAutocomplete`
Expected: PASS, 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/wikiLinkAutocomplete.ts packages/editor/src/wikiLinkAutocomplete.test.ts
git commit -m "feat(editor): add wiki-link autocomplete source triggered on double bracket"
```

---

## Task 8: Live preview decorations for headings, bold, italic, inline code, code blocks

**Files:**
- Create: `packages/editor/src/livePreview.ts`

- [ ] **Step 1: Implement the decoration plugin**

Create `packages/editor/src/livePreview.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/editor build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/livePreview.ts
git commit -m "feat(editor): live preview decorations for markdown structure"
```

---

## Task 9: NoteEditor React component assembling the extensions

**Files:**
- Create: `packages/editor/src/NoteEditor.tsx`
- Modify: `packages/editor/src/index.ts`

- [ ] **Step 1: Implement NoteEditor**

Create `packages/editor/src/NoteEditor.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { baseTheme } from './theme';
import { wikiLinkField } from './wikiLinkField';
import { wikiLinkExtension, WikiLinkContext } from './wikiLinkExtension';
import { wikiLinkAutocomplete, WikiSearchResult } from './wikiLinkAutocomplete';
import { livePreview } from './livePreview';

export interface NoteEditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  onDropFiles?: (files: File[], pos: number) => Promise<string | null>;
  resolveTitle: WikiLinkContext['resolveTitle'];
  onNavigate: WikiLinkContext['onNavigate'];
  onCreateRequest: WikiLinkContext['onCreateRequest'];
  searchTitles: (q: string) => Promise<WikiSearchResult[]>;
}

export function NoteEditor(props: NoteEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  const onDropRef = useRef(props.onDropFiles);
  onChangeRef.current = props.onChange;
  onDropRef.current = props.onDropFiles;

  useEffect(() => {
    if (!host.current) return;

    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) onChangeRef.current(u.state.doc.toString());
    });

    const dropHandler = EditorView.domEventHandlers({
      drop(event, view) {
        if (!event.dataTransfer || event.dataTransfer.files.length === 0) return false;
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        const pos =
          view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        (async () => {
          const handler = onDropRef.current;
          if (!handler) return;
          const markdown = await handler(files, pos);
          if (markdown) {
            view.dispatch({ changes: { from: pos, insert: markdown } });
          }
        })();
        return true;
      },
    });

    const state = EditorState.create({
      doc: props.initialValue,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        baseTheme,
        wikiLinkField,
        wikiLinkExtension({
          resolveTitle: props.resolveTitle,
          onNavigate: props.onNavigate,
          onCreateRequest: props.onCreateRequest,
        }),
        wikiLinkAutocomplete({ search: props.searchTitles }),
        livePreview,
        listener,
        dropHandler,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} style={{ height: '100%', width: '100%' }} data-testid="note-editor" />;
}
```

- [ ] **Step 2: Update index exports**

Modify `packages/editor/src/index.ts`:

```ts
export { NoteEditor } from './NoteEditor';
export type { NoteEditorProps } from './NoteEditor';
export { wikiLinkField, getWikiLinks } from './wikiLinkField';
export type { EditorWikiLink } from './wikiLinkField';
export { wikiLinkExtension } from './wikiLinkExtension';
export type { WikiLinkContext } from './wikiLinkExtension';
export { wikiLinkAutocomplete, buildWikiLinkSource } from './wikiLinkAutocomplete';
export type { WikiSearchResult } from './wikiLinkAutocomplete';
export { livePreview } from './livePreview';
export { baseTheme } from './theme';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/editor build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/NoteEditor.tsx packages/editor/src/index.ts
git commit -m "feat(editor): NoteEditor React component wiring all extensions"
```

---

## Task 10: Add @km/editor as a dependency of apps/web

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add dependency**

Modify `apps/web/package.json`, add under `dependencies`:

```json
    "@km/editor": "workspace:*",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: adds entry, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): depend on @km/editor workspace package"
```

---

## Task 11: Server-side attachment helpers

**Files:**
- Create: `apps/web/src/lib/attachments.ts`

- [ ] **Step 1: Implement the helper module**

Create `apps/web/src/lib/attachments.ts`:

```ts
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? '/data';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/', 'video/', 'audio/'];

export class AttachmentTooLargeError extends Error {
  constructor() {
    super('attachment too large');
  }
}

export class AttachmentTypeError extends Error {
  constructor(mime: string) {
    super(`unsupported mime type: ${mime}`);
  }
}

export function attachmentDir(vaultId: string): string {
  return path.join(DATA_DIR, 'vaults', vaultId, 'attachments');
}

export function attachmentPath(vaultId: string, id: string, filename: string): string {
  return path.join(attachmentDir(vaultId), `${id}-${sanitizeFilename(filename)}`);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
}

export function validateMime(mime: string): void {
  if (!ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p))) {
    throw new AttachmentTypeError(mime);
  }
}

export async function persistAttachment(params: {
  vaultId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ id: string; storagePath: string; size: number }> {
  if (params.buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError();
  }
  validateMime(params.mimeType);
  const id = randomUUID();
  const dir = attachmentDir(params.vaultId);
  await mkdir(dir, { recursive: true });
  const storagePath = attachmentPath(params.vaultId, id, params.filename);
  await writeFile(storagePath, params.buffer);
  return { id, storagePath, size: params.buffer.byteLength };
}

export async function openAttachment(storagePath: string) {
  const s = await stat(storagePath);
  return { size: s.size, stream: createReadStream(storagePath) };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/attachments.ts
git commit -m "feat(web): attachment persistence helpers under DATA_DIR"
```

---

## Task 12: POST /api/attachments (multipart upload)

**Files:**
- Create: `apps/web/src/app/api/attachments/route.ts`
- Create: `apps/web/tests/integration/attachments.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `apps/web/tests/integration/attachments.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@km/db';
import { POST } from '@/app/api/attachments/route';
import { GET } from '@/app/api/attachments/[id]/route';
import { createUserWithVault, sessionForUser } from '../helpers/auth';
import { withSession } from '../helpers/request';

let alice: Awaited<ReturnType<typeof createUserWithVault>>;
let bob: Awaited<ReturnType<typeof createUserWithVault>>;

beforeAll(async () => {
  alice = await createUserWithVault('alice@test');
  bob = await createUserWithVault('bob@test');
});

afterAll(async () => {
  await prisma.attachment.deleteMany({});
});

function buildFormDataRequest(url: string, form: FormData): Request {
  return new Request(url, { method: 'POST', body: form });
}

describe('POST /api/attachments', () => {
  it('rejects unauthenticated requests', async () => {
    const form = new FormData();
    form.append('vaultId', alice.vaultId);
    form.append('file', new Blob([Buffer.from('hi')], { type: 'text/plain' }), 'hello.txt');
    const res = await POST(buildFormDataRequest('http://x/api/attachments', form));
    expect(res.status).toBe(401);
  });

  it('rejects uploads to a vault the user cannot access', async () => {
    const form = new FormData();
    form.append('vaultId', bob.vaultId);
    form.append('file', new Blob([Buffer.from('hi')], { type: 'text/plain' }), 'hello.txt');
    const res = await withSession(sessionForUser(alice.userId), () =>
      POST(buildFormDataRequest('http://x/api/attachments', form)),
    );
    expect(res.status).toBe(403);
  });

  it('stores a file and returns a markdown snippet', async () => {
    const form = new FormData();
    form.append('vaultId', alice.vaultId);
    form.append('file', new Blob([Buffer.from('PNGDATA')], { type: 'image/png' }), 'pic.png');
    const res = await withSession(sessionForUser(alice.userId), () =>
      POST(buildFormDataRequest('http://x/api/attachments', form)),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.markdown).toMatch(/^!\[\]\(\/api\/attachments\/[0-9a-f-]+\)$/);
    const row = await prisma.attachment.findUnique({ where: { id: body.id } });
    expect(row?.filename).toBe('pic.png');
    expect(row?.mimeType).toBe('image/png');
    expect(row?.vaultId).toBe(alice.vaultId);
  });

  it('rejects files over the 25MB limit', async () => {
    const form = new FormData();
    form.append('vaultId', alice.vaultId);
    form.append(
      'file',
      new Blob([Buffer.alloc(26 * 1024 * 1024, 0)], { type: 'image/png' }),
      'big.png',
    );
    const res = await withSession(sessionForUser(alice.userId), () =>
      POST(buildFormDataRequest('http://x/api/attachments', form)),
    );
    expect(res.status).toBe(413);
  });
});

describe('GET /api/attachments/:id', () => {
  it('streams the file for an authorised user', async () => {
    const form = new FormData();
    form.append('vaultId', alice.vaultId);
    form.append('file', new Blob([Buffer.from('hello-bytes')], { type: 'text/plain' }), 't.txt');
    const up = await withSession(sessionForUser(alice.userId), () =>
      POST(buildFormDataRequest('http://x/api/attachments', form)),
    );
    const { id } = await up.json();

    const res = await withSession(sessionForUser(alice.userId), () =>
      GET(new Request(`http://x/api/attachments/${id}`), { params: { id } }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello-bytes');
  });

  it('refuses streaming to an unauthorised user', async () => {
    const form = new FormData();
    form.append('vaultId', alice.vaultId);
    form.append('file', new Blob([Buffer.from('secret')], { type: 'text/plain' }), 's.txt');
    const up = await withSession(sessionForUser(alice.userId), () =>
      POST(buildFormDataRequest('http://x/api/attachments', form)),
    );
    const { id } = await up.json();

    const res = await withSession(sessionForUser(bob.userId), () =>
      GET(new Request(`http://x/api/attachments/${id}`), { params: { id } }),
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter web test:integration attachments`
Expected: FAIL with `Cannot find module '@/app/api/attachments/route'`.

- [ ] **Step 3: Implement POST route**

Create `apps/web/src/app/api/attachments/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { assertCanAccessVault } from '@/lib/auth/assertCanAccessVault';
import { prisma } from '@km/db';
import {
  persistAttachment,
  AttachmentTooLargeError,
  AttachmentTypeError,
} from '@/lib/attachments';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const form = await req.formData();
  const vaultId = form.get('vaultId');
  const file = form.get('file');
  if (typeof vaultId !== 'string' || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  try {
    await assertCanAccessVault(session.user.id, vaultId, 'MEMBER');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const filename = (file as File).name ?? 'file';
  const mimeType = file.type || 'application/octet-stream';
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const persisted = await persistAttachment({ vaultId, filename, mimeType, buffer });
    const row = await prisma.attachment.create({
      data: {
        id: persisted.id,
        vaultId,
        filename,
        mimeType,
        size: persisted.size,
        storagePath: persisted.storagePath,
        uploadedById: session.user.id,
      },
    });
    return NextResponse.json(
      { id: row.id, markdown: `![](/api/attachments/${row.id})` },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof AttachmentTooLargeError) {
      return NextResponse.json({ error: 'too large' }, { status: 413 });
    }
    if (e instanceof AttachmentTypeError) {
      return NextResponse.json({ error: 'unsupported type' }, { status: 415 });
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run the upload tests and confirm POST tests pass (GET still fails)**

Run: `pnpm --filter web test:integration attachments`
Expected: POST tests PASS, GET tests FAIL (GET not implemented yet).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/attachments/route.ts apps/web/tests/integration/attachments.test.ts
git commit -m "feat(web): POST /api/attachments multipart upload"
```

---

## Task 13: GET /api/attachments/:id streaming

**Files:**
- Create: `apps/web/src/app/api/attachments/[id]/route.ts`

- [ ] **Step 1: Implement GET route**

Create `apps/web/src/app/api/attachments/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { assertCanAccessVault } from '@/lib/auth/assertCanAccessVault';
import { prisma } from '@km/db';
import { openAttachment } from '@/lib/attachments';
import { Readable } from 'node:stream';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const row = await prisma.attachment.findUnique({ where: { id: ctx.params.id } });
  if (!row) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    await assertCanAccessVault(session.user.id, row.vaultId, 'MEMBER');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { stream, size } = await openAttachment(row.storagePath);
  const web = Readable.toWeb(stream) as unknown as ReadableStream;
  return new Response(web, {
    status: 200,
    headers: {
      'Content-Type': row.mimeType,
      'Content-Length': String(size),
      'Content-Disposition': `inline; filename="${row.filename.replace(/"/g, '')}"`,
    },
  });
}
```

- [ ] **Step 2: Run attachment tests and confirm all pass**

Run: `pnpm --filter web test:integration attachments`
Expected: all 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/attachments/[id]/route.ts
git commit -m "feat(web): GET /api/attachments/:id authorised streaming"
```

---

## Task 14: Link recomputation on PATCH /api/notes/:id

**Files:**
- Create: `apps/web/tests/integration/link-recompute.test.ts`
- Modify: `apps/web/src/app/api/notes/[id]/route.ts`

- [ ] **Step 1: Write failing integration tests**

Create `apps/web/tests/integration/link-recompute.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@km/db';
import { PATCH } from '@/app/api/notes/[id]/route';
import { createUserWithVault, sessionForUser } from '../helpers/auth';
import { withSession } from '../helpers/request';

let alice: Awaited<ReturnType<typeof createUserWithVault>>;
let noteA: { id: string };
let noteB: { id: string };
let noteC: { id: string };

beforeAll(async () => {
  alice = await createUserWithVault('link-alice@test');
  noteA = await prisma.note.create({
    data: { vaultId: alice.vaultId, title: 'Alpha', slug: 'alpha', content: '', createdById: alice.userId, updatedById: alice.userId },
  });
  noteB = await prisma.note.create({
    data: { vaultId: alice.vaultId, title: 'Beta', slug: 'beta', content: '', createdById: alice.userId, updatedById: alice.userId },
  });
  noteC = await prisma.note.create({
    data: { vaultId: alice.vaultId, title: 'Source', slug: 'source', content: '', createdById: alice.userId, updatedById: alice.userId },
  });
});

async function patch(id: string, body: unknown) {
  return withSession(sessionForUser(alice.userId), () =>
    PATCH(
      new Request(`http://x/api/notes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: { id } },
    ),
  );
}

describe('PATCH /api/notes/:id link recomputation', () => {
  it('creates resolved link rows for known targets', async () => {
    const res = await patch(noteC.id, { content: 'see [[Alpha]] and [[Beta]]' });
    expect(res.status).toBe(200);
    const links = await prisma.link.findMany({ where: { sourceNoteId: noteC.id } });
    expect(links).toHaveLength(2);
    const titles = links.map((l) => l.targetTitle).sort();
    expect(titles).toEqual(['Alpha', 'Beta']);
    for (const l of links) {
      expect(l.resolved).toBe(true);
      expect(l.targetNoteId).not.toBeNull();
    }
  });

  it('marks unknown targets as unresolved', async () => {
    await patch(noteC.id, { content: 'see [[Ghost]]' });
    const links = await prisma.link.findMany({ where: { sourceNoteId: noteC.id } });
    expect(links).toHaveLength(1);
    expect(links[0].resolved).toBe(false);
    expect(links[0].targetNoteId).toBeNull();
  });

  it('replaces the link set atomically across saves', async () => {
    await patch(noteC.id, { content: '[[Alpha]]' });
    const first = await prisma.link.findMany({ where: { sourceNoteId: noteC.id } });
    expect(first.map((l) => l.targetTitle)).toEqual(['Alpha']);
    await patch(noteC.id, { content: '[[Beta]]' });
    const second = await prisma.link.findMany({ where: { sourceNoteId: noteC.id } });
    expect(second.map((l) => l.targetTitle)).toEqual(['Beta']);
  });

  it('leaves no link rows when content has no wiki-links', async () => {
    await patch(noteC.id, { content: 'plain text only' });
    const rows = await prisma.link.findMany({ where: { sourceNoteId: noteC.id } });
    expect(rows).toEqual([]);
  });

  it('never writes content without writing links in the same transaction', async () => {
    await prisma.link.deleteMany({ where: { sourceNoteId: noteC.id } });
    await patch(noteC.id, { content: '[[Alpha]] body' });
    const note = await prisma.note.findUnique({ where: { id: noteC.id } });
    const links = await prisma.link.findMany({ where: { sourceNoteId: noteC.id } });
    expect(note?.content).toBe('[[Alpha]] body');
    expect(links.map((l) => l.targetTitle)).toEqual(['Alpha']);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter web test:integration link-recompute`
Expected: FAIL because handler does not write `Link` rows.

- [ ] **Step 3: Modify PATCH handler to recompute links in a transaction**

Replace the body of `PATCH` in `apps/web/src/app/api/notes/[id]/route.ts` with the following (keep surrounding imports, add `parseWikiLinks` import):

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { assertCanAccessVault } from '@/lib/auth/assertCanAccessVault';
import { prisma } from '@km/db';
import { parseWikiLinks } from '@km/shared';
import { z } from 'zod';

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  folderId: z.string().nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const existing = await prisma.note.findUnique({ where: { id: ctx.params.id } });
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    await assertCanAccessVault(session.user.id, existing.vaultId, 'MEMBER');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = PatchSchema.parse(await req.json());

  const updated = await prisma.$transaction(async (tx) => {
    const note = await tx.note.update({
      where: { id: ctx.params.id },
      data: {
        title: body.title ?? existing.title,
        content: body.content ?? existing.content,
        folderId: body.folderId === undefined ? existing.folderId : body.folderId,
        updatedById: session.user.id,
        contentUpdatedAt: body.content !== undefined ? new Date() : existing.contentUpdatedAt,
      },
    });

    if (body.content !== undefined) {
      const parsed = parseWikiLinks(body.content);
      const uniqueTitles = Array.from(new Set(parsed.map((p) => p.title)));
      const targets = uniqueTitles.length
        ? await tx.note.findMany({
            where: { vaultId: existing.vaultId, title: { in: uniqueTitles } },
            select: { id: true, title: true },
          })
        : [];
      const titleToId = new Map(targets.map((t) => [t.title, t.id]));

      await tx.link.deleteMany({ where: { sourceNoteId: note.id } });
      if (parsed.length > 0) {
        await tx.link.createMany({
          data: parsed.map((p) => ({
            sourceNoteId: note.id,
            targetNoteId: titleToId.get(p.title) ?? null,
            targetTitle: p.title,
            resolved: titleToId.has(p.title),
          })),
        });
      }
    }

    return note;
  });

  return NextResponse.json({ note: updated });
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm --filter web test:integration link-recompute`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/notes/[id]/route.ts apps/web/tests/integration/link-recompute.test.ts
git commit -m "feat(web): recompute Link rows transactionally on note save"
```

---

## Task 15: Backlinks endpoint with snippets

**Files:**
- Create: `apps/web/tests/integration/backlinks-snippets.test.ts`
- Modify: `apps/web/src/app/api/notes/[id]/backlinks/route.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/tests/integration/backlinks-snippets.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@km/db';
import { PATCH } from '@/app/api/notes/[id]/route';
import { GET } from '@/app/api/notes/[id]/backlinks/route';
import { createUserWithVault, sessionForUser } from '../helpers/auth';
import { withSession } from '../helpers/request';

let alice: Awaited<ReturnType<typeof createUserWithVault>>;
let target: { id: string };
let source1: { id: string };
let source2: { id: string };

beforeAll(async () => {
  alice = await createUserWithVault('bl-alice@test');
  target = await prisma.note.create({
    data: { vaultId: alice.vaultId, title: 'Target', slug: 'target', content: '', createdById: alice.userId, updatedById: alice.userId },
  });
  source1 = await prisma.note.create({
    data: { vaultId: alice.vaultId, title: 'Src1', slug: 'src1', content: '', createdById: alice.userId, updatedById: alice.userId },
  });
  source2 = await prisma.note.create({
    data: { vaultId: alice.vaultId, title: 'Src2', slug: 'src2', content: '', createdById: alice.userId, updatedById: alice.userId },
  });

  const patch = (id: string, content: string) =>
    withSession(sessionForUser(alice.userId), () =>
      PATCH(
        new Request(`http://x/api/notes/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ content }),
          headers: { 'Content-Type': 'application/json' },
        }),
        { params: { id } },
      ),
    );

  await patch(source1.id, `${'x'.repeat(200)} see [[Target]] ${'y'.repeat(200)}`);
  await patch(source2.id, `head before [[Target|alias]] rest`);
});

describe('GET /api/notes/:id/backlinks', () => {
  it('returns each source with a snippet', async () => {
    const res = await withSession(sessionForUser(alice.userId), () =>
      GET(new Request(`http://x/api/notes/${target.id}/backlinks`), { params: { id: target.id } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backlinks).toHaveLength(2);
    const byTitle = Object.fromEntries(body.backlinks.map((b: { sourceTitle: string; snippet: string }) => [b.sourceTitle, b]));
    expect(byTitle['Src1'].snippet).toContain('[[Target]]');
    expect(byTitle['Src1'].snippet.startsWith('...')).toBe(true);
    expect(byTitle['Src2'].snippet).toContain('[[Target|alias]]');
  });

  it('forbids callers without vault access', async () => {
    const other = await createUserWithVault('bl-bob@test');
    const res = await withSession(sessionForUser(other.userId), () =>
      GET(new Request(`http://x/api/notes/${target.id}/backlinks`), { params: { id: target.id } }),
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `pnpm --filter web test:integration backlinks-snippets`
Expected: FAIL because the stub returns an empty array.

- [ ] **Step 3: Replace the backlinks route**

Replace the entire contents of `apps/web/src/app/api/notes/[id]/backlinks/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/options';
import { assertCanAccessVault } from '@/lib/auth/assertCanAccessVault';
import { prisma } from '@km/db';
import { computeSnippet } from '@km/shared';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const target = await prisma.note.findUnique({ where: { id: ctx.params.id } });
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    await assertCanAccessVault(session.user.id, target.vaultId, 'MEMBER');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const links = await prisma.link.findMany({
    where: { targetNoteId: target.id },
    include: {
      sourceNote: { select: { id: true, title: true, content: true } },
    },
  });

  const backlinks = links.map((l) => ({
    sourceNoteId: l.sourceNote.id,
    sourceTitle: l.sourceNote.title,
    snippet: computeSnippet(l.sourceNote.content, target.title),
  }));

  return NextResponse.json({ backlinks });
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `pnpm --filter web test:integration backlinks-snippets`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/notes/[id]/backlinks/route.ts apps/web/tests/integration/backlinks-snippets.test.ts
git commit -m "feat(web): backlinks endpoint returns server-computed snippets"
```

---

## Task 16: BacklinksPanel React component

**Files:**
- Create: `apps/web/src/components/BacklinksPanel.tsx`

- [ ] **Step 1: Implement the panel**

Create `apps/web/src/components/BacklinksPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Backlink {
  sourceNoteId: string;
  sourceTitle: string;
  snippet: string;
}

export function BacklinksPanel({ noteId, reloadKey }: { noteId: string; reloadKey: number }) {
  const [items, setItems] = useState<Backlink[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetch(`/api/notes/${noteId}/backlinks`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        return r.json();
      })
      .then((body) => {
        if (!cancelled) setItems(body.backlinks);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, reloadKey]);

  return (
    <aside data-testid="backlinks-panel" style={{ padding: '12px', borderLeft: '1px solid #d0d7de', width: '280px', overflowY: 'auto' }}>
      <h3 style={{ fontSize: '13px', textTransform: 'uppercase', color: '#57606a' }}>Backlinks</h3>
      {error && <p style={{ color: '#cf222e' }}>{error}</p>}
      {items === null && !error && <p>Loading...</p>}
      {items && items.length === 0 && <p style={{ color: '#57606a' }}>No backlinks.</p>}
      {items && items.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((b) => (
            <li key={b.sourceNoteId} style={{ padding: '8px 0', borderBottom: '1px solid #eaeef2' }}>
              <Link href={`/notes/${b.sourceNoteId}`} style={{ fontWeight: 600 }}>
                {b.sourceTitle}
              </Link>
              <div style={{ fontSize: '12px', color: '#57606a', marginTop: '4px' }}>{b.snippet}</div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/BacklinksPanel.tsx
git commit -m "feat(web): BacklinksPanel component"
```

---

## Task 17: CreateNoteDialog for unresolved wiki-link clicks

**Files:**
- Create: `apps/web/src/components/CreateNoteDialog.tsx`

- [ ] **Step 1: Implement the dialog**

Create `apps/web/src/components/CreateNoteDialog.tsx`:

```tsx
'use client';

import { useState } from 'react';

export interface CreateNoteDialogProps {
  open: boolean;
  title: string;
  vaultId: string;
  onCancel: () => void;
  onCreated: (noteId: string) => void;
}

export function CreateNoteDialog(props: CreateNoteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.open) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: props.vaultId, title: props.title, content: '' }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = await res.json();
      props.onCreated(body.note.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Create note"
      data-testid="create-note-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.3)',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div style={{ background: 'white', padding: '20px', borderRadius: '6px', minWidth: '320px' }}>
        <h2>Create note "{props.title}"?</h2>
        {error && <p style={{ color: '#cf222e' }}>{error}</p>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
          <button onClick={props.onCancel} disabled={busy}>
            Cancel
          </button>
          <button onClick={submit} disabled={busy} data-testid="confirm-create-note">
            {busy ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/CreateNoteDialog.tsx
git commit -m "feat(web): CreateNoteDialog for unresolved wiki-link targets"
```

---

## Task 18: Replace textarea with NoteEditor on the note page

**Files:**
- Modify: `apps/web/src/app/(app)/notes/[id]/page.tsx`

- [ ] **Step 1: Rewrite the page to use NoteEditor, BacklinksPanel, CreateNoteDialog**

Replace the entire contents of `apps/web/src/app/(app)/notes/[id]/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NoteEditor } from '@km/editor';
import { useDebouncedAutosave } from '@/lib/autosave';
import { BacklinksPanel } from '@/components/BacklinksPanel';
import { CreateNoteDialog } from '@/components/CreateNoteDialog';

interface NotePageProps {
  params: { id: string };
}

interface NoteDto {
  id: string;
  vaultId: string;
  title: string;
  content: string;
}

export default function NotePage({ params }: NotePageProps) {
  const router = useRouter();
  const [note, setNote] = useState<NoteDto | null>(null);
  const [content, setContent] = useState('');
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [dialogTitle, setDialogTitle] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch(`/api/notes/${params.id}`)
      .then((r) => r.json())
      .then((body) => {
        setNote(body.note);
        setContent(body.note.content);
      });
  }, [params.id]);

  useEffect(() => {
    if (!note) return;
    fetch(`/api/vaults/${note.vaultId}/tree`)
      .then((r) => r.json())
      .then((body: { notes: { id: string; title: string }[] }) => {
        setTitleMap(new Map(body.notes.map((n) => [n.title, n.id])));
      });
  }, [note]);

  const save = useCallback(
    async (value: string) => {
      await fetch(`/api/notes/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
      });
      setReloadKey((k) => k + 1);
    },
    [params.id],
  );

  const { saving } = useDebouncedAutosave(content, 1500, save);

  const resolveTitle = useCallback(
    (title: string) => {
      const id = titleMap.get(title);
      return id ? { noteId: id } : null;
    },
    [titleMap],
  );

  const searchTitles = useCallback(
    async (q: string) => {
      if (!note) return [];
      const res = await fetch(
        `/api/notes/search?q=${encodeURIComponent(q)}&vaultId=${note.vaultId}`,
      );
      if (!res.ok) return [];
      const body: { results: { id: string; title: string }[] } = await res.json();
      return body.results;
    },
    [note],
  );

  const onDropFiles = useCallback(
    async (files: File[], _pos: number): Promise<string | null> => {
      if (!note) return null;
      const parts: string[] = [];
      for (const f of files) {
        const form = new FormData();
        form.append('vaultId', note.vaultId);
        form.append('file', f);
        const res = await fetch('/api/attachments', { method: 'POST', body: form });
        if (!res.ok) continue;
        const body: { markdown: string } = await res.json();
        parts.push(body.markdown);
      }
      return parts.length ? parts.join('\n') : null;
    },
    [note],
  );

  const editor = useMemo(() => {
    if (!note) return null;
    return (
      <NoteEditor
        initialValue={note.content}
        onChange={setContent}
        onDropFiles={onDropFiles}
        resolveTitle={resolveTitle}
        onNavigate={(id) => router.push(`/notes/${id}`)}
        onCreateRequest={(title) => setDialogTitle(title)}
        searchTitles={searchTitles}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  if (!note) return <div>Loading...</div>;

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '12px', borderBottom: '1px solid #d0d7de', display: 'flex', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: '18px', margin: 0 }}>{note.title}</h1>
          <span style={{ color: '#57606a', fontSize: '12px' }}>{saving ? 'Saving...' : 'Saved'}</span>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>{editor}</div>
      </div>
      <BacklinksPanel noteId={note.id} reloadKey={reloadKey} />
      <CreateNoteDialog
        open={dialogTitle !== null}
        title={dialogTitle ?? ''}
        vaultId={note.vaultId}
        onCancel={() => setDialogTitle(null)}
        onCreated={(id) => {
          setDialogTitle(null);
          router.push(`/notes/${id}`);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/notes/\[id\]/page.tsx
git commit -m "feat(web): use CodeMirror NoteEditor with backlinks and drag-drop attachments"
```

---

## Task 19: Playwright E2E for the golden wiki-link path

**Files:**
- Create: `apps/web/tests/e2e/wiki-links.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

Create `apps/web/tests/e2e/wiki-links.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { signUpAndLogin } from './helpers/auth';

test('create two notes, link B to A, see backlink, click to navigate', async ({ page }) => {
  await signUpAndLogin(page, 'wl@test.local', 'password123');

  // Create note A titled "Alpha".
  await page.getByTestId('new-note-button').click();
  await page.getByTestId('new-note-title').fill('Alpha');
  await page.getByTestId('new-note-submit').click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+/);

  // Go back to tree, create note B titled "Beta".
  await page.getByTestId('new-note-button').click();
  await page.getByTestId('new-note-title').fill('Beta');
  await page.getByTestId('new-note-submit').click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+/);
  const betaUrl = page.url();

  // Type content in Beta containing [[Alpha]].
  const editor = page.getByTestId('note-editor').locator('.cm-content');
  await editor.click();
  await page.keyboard.type('prelude [[Alpha]] epilogue');

  // Wait for autosave (>1.5s debounce plus request).
  await expect(page.getByText('Saved')).toBeVisible({ timeout: 5000 });

  // Open Alpha via the file tree and confirm the backlink from Beta is visible with a snippet.
  await page.getByTestId('file-tree').getByText('Alpha', { exact: true }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]+/);
  await expect(page.locator('h1')).toHaveText('Alpha');
  const backlinks = page.getByTestId('backlinks-panel');
  await expect(backlinks).toContainText('Beta');
  await expect(backlinks).toContainText('[[Alpha]]');

  // Click the backlink to navigate to Beta.
  await backlinks.getByRole('link', { name: 'Beta' }).click();
  await expect(page).toHaveURL(betaUrl);

  // Cmd-click the [[Alpha]] token in the editor to navigate back.
  const alphaToken = page.locator('.cm-wiki-link', { hasText: 'Alpha' }).first();
  await alphaToken.click({ modifiers: ['Meta'] });
  await page.waitForURL(/\/notes\/[0-9a-f-]+/);
  await expect(page.locator('h1')).toHaveText('Alpha');
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm --filter web exec playwright test wiki-links.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/wiki-links.spec.ts
git commit -m "test(web): e2e golden path for wiki-link navigation and backlinks"
```

---

## Task 20: Full test suite green-light

- [ ] **Step 1: Run unit tests for shared and editor**

Run: `pnpm --filter @km/shared test && pnpm --filter @km/editor test`
Expected: all tests pass.

- [ ] **Step 2: Run integration suite**

Run: `pnpm --filter web test:integration`
Expected: all tests pass including `link-recompute`, `backlinks-snippets`, `attachments`.

- [ ] **Step 3: Run Playwright suite**

Run: `pnpm --filter web exec playwright test`
Expected: all specs pass including `wiki-links.spec.ts`.

- [ ] **Step 4: Typecheck the monorepo**

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 5: Final commit if any tidy-up diffs**

```bash
git status
# if no changes, skip
```

If any auto-formatter diffs exist, run:

```bash
git add -A
git commit -m "chore: final format pass for plan C"
```

---

## Summary

This plan produces an Obsidian-like editing experience: CodeMirror 6 with markdown, wiki-link tokenisation with cmd or ctrl-click navigation, autocomplete on `[[`, live preview for headings, bold, italic, inline code, and code blocks. Wiki-link parsing is a pure `parseWikiLinks` utility in `packages/shared`, unit-tested against fences, inline code, escapes, malformed input, and aliases. Saves recompute the `Link` table transactionally. The backlinks panel on the right sidebar shows source titles with a server-computed 120-char snippet around the match. Attachments are uploaded via drag-and-drop, stored under `${DATA_DIR}/vaults/<vaultId>/attachments/`, and streamed back through an authorised route. End-to-end, Playwright verifies creating two notes, linking them, seeing the backlink, and navigating via the backlink and via cmd-click inside the editor.
