# Phase 4 Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drawio and BPMN diagrams as first-class vault items, each with its own editor page, persisted as XML rows in a new `Diagram` table, integrated into the file tree, wiki-link resolution, and markdown export.

**Architecture:** A new Prisma `Diagram` model with a `DiagramKind` enum stores `.drawio` and `.bpmn` XML in Postgres, sibling to `Note`. A new `@km/diagrams` package ships two React components: `DrawioFrame`, which hosts the self-hosted drawio webapp in an iframe and talks to it over `postMessage`, and `BpmnCanvas`, which wraps a `bpmn-js` modeler. Diagram API routes mirror note routes with optimistic concurrency. The file tree, wiki-link resolver, and export worker are extended to treat notes and diagrams as a single stream of items keyed by `kind`.

**Tech Stack:** Prisma 5, Next.js 14 App Router, React 18, TypeScript, self-hosted drawio webapp (vendored), `bpmn-js`, `bpmn-moddle`, pg-boss, Vitest, Playwright.

---

## File Structure

New files:

- `packages/db/prisma/migrations/<timestamp>_phase4_diagrams/migration.sql` - migration generated from schema edits.
- `packages/shared/src/diagrams.ts` - `DiagramKind`, `diagramCreateSchema`, `diagramPatchSchema`, `slugifyDiagramTitle`.
- `packages/shared/src/diagrams.test.ts`.
- `packages/diagrams/package.json` - new workspace package manifest.
- `packages/diagrams/tsconfig.json`.
- `packages/diagrams/src/index.ts` - re-exports.
- `packages/diagrams/src/drawio/DrawioFrame.tsx` - iframe host component.
- `packages/diagrams/src/drawio/postMessageBridge.ts` - typed message helpers and origin guard.
- `packages/diagrams/src/drawio/postMessageBridge.test.ts`.
- `packages/diagrams/src/drawio/blankDrawio.ts` - empty drawio XML stub.
- `packages/diagrams/src/bpmn/BpmnCanvas.tsx` - bpmn-js wrapper component.
- `packages/diagrams/src/bpmn/blankBpmn.ts` - empty BPMN XML stub.
- `packages/diagrams/src/bpmn/stub.test.ts`.
- `apps/web/public/drawio/VERSION` - pinned drawio upstream SHA.
- `apps/web/public/drawio/...` - vendored drawio webapp tree.
- `scripts/vendor-drawio.sh` - copy script for drawio assets.
- `apps/web/src/app/api/diagrams/route.ts` - `POST /api/diagrams`.
- `apps/web/src/app/api/diagrams/[id]/route.ts` - `GET/PATCH/DELETE /api/diagrams/:id`.
- `apps/web/src/app/api/diagrams/[id]/backlinks/route.ts` - `GET /api/diagrams/:id/backlinks`.
- `apps/web/src/app/api/diagrams/search/route.ts` - `GET /api/diagrams/search`.
- `apps/web/src/app/api/links/resolve/route.ts` - `GET /api/links/resolve`.
- `apps/web/src/app/(app)/vault/[vaultId]/diagram/[diagramId]/page.tsx` - diagram page.
- `apps/web/src/app/(app)/vault/[vaultId]/diagram/[diagramId]/DiagramHost.tsx` - client component selecting drawio or bpmn.
- `apps/web/test/api/diagrams.test.ts` - integration tests for diagram routes.
- `apps/web/test/api/tree-diagrams.test.ts` - tree endpoint includes diagrams.
- `apps/web/playwright/diagrams-drawio.spec.ts`.
- `apps/web/playwright/diagrams-bpmn.spec.ts`.
- `apps/web/playwright/diagrams-link.spec.ts`.
- `guides/diagrams.md`.

Modified files:

- `packages/db/prisma/schema.prisma` - add `DiagramKind`, `Diagram`, extend `Link`, `Vault`, `Folder`.
- `packages/shared/src/index.ts` - re-export diagram schemas.
- `apps/web/package.json` - add `@km/diagrams` workspace dep.
- `packages/diagrams/package.json` - add `bpmn-js`, `bpmn-moddle`, `react`, `react-dom` deps.
- `pnpm-workspace.yaml` - no change if `packages/*` already a glob; verify.
- `apps/web/src/lib/links.ts` - extend `recomputeLinks` and add `resolveLinkTargets`.
- `apps/web/src/lib/links.test.ts` - add note-vs-diagram resolution cases.
- `apps/web/src/app/api/vaults/[id]/tree/route.ts` - include diagrams as `items`.
- `apps/web/src/components/FileTree.tsx` - render diagram items with icons and new context menu entries.
- `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx` - backlinks query unchanged; wiki-link click uses `/api/links/resolve`.
- `packages/editor/src/wikiLinks.ts` (or equivalent) - click handler calls resolve endpoint.
- `apps/worker/src/export.ts` - write diagrams into the archive.
- `apps/worker/test/export.test.ts` - assert diagrams present in archive.
- `docs/architecture.md` - add "Diagrams" section.
- `docs/data-model.md` - document `Diagram` and extended `Link`.
- `docs/api.md` - document diagram routes.
- `docs/deployment.md` - document drawio vendoring refresh.
- `.github/workflows/ci.yml` - ensure new package builds.

---

## Task 1: Prisma schema and migration for Diagram

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_phase4_diagrams/migration.sql`

- [ ] **Step 1: Edit `packages/db/prisma/schema.prisma`**

Add after the existing `ExportStatus` enum block:

```prisma
enum DiagramKind {
  DRAWIO
  BPMN
}

model Diagram {
  id               String      @id @default(cuid())
  vaultId          String
  folderId         String?
  kind             DiagramKind
  title            String
  slug             String
  xml              String      @db.Text
  contentUpdatedAt DateTime    @default(now())
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  createdById      String
  updatedById      String

  vault  Vault   @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  folder Folder? @relation(fields: [folderId], references: [id], onDelete: SetNull)

  incomingLinks Link[] @relation("TargetDiagram")

  @@unique([vaultId, slug])
  @@index([vaultId])
  @@index([folderId])
  @@index([vaultId, kind])
}
```

Extend `Vault`:

```prisma
  diagrams Diagram[]
```

Extend `Folder`:

```prisma
  diagrams Diagram[]
```

Replace the `Link` model block with:

```prisma
model Link {
  id              String   @id @default(cuid())
  sourceNoteId    String
  targetNoteId    String?
  targetDiagramId String?
  targetTitle     String
  resolved        Boolean  @default(false)
  createdAt       DateTime @default(now())

  sourceNote    Note     @relation("SourceNote", fields: [sourceNoteId], references: [id], onDelete: Cascade)
  targetNote    Note?    @relation("TargetNote", fields: [targetNoteId], references: [id], onDelete: SetNull)
  targetDiagram Diagram? @relation("TargetDiagram", fields: [targetDiagramId], references: [id], onDelete: SetNull)

  @@index([sourceNoteId])
  @@index([targetNoteId])
  @@index([targetDiagramId])
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @km/db prisma migrate dev --name phase4_diagrams`
Expected: migration file created, `prisma migrate` reports "The migration has been applied", `prisma generate` runs.

- [ ] **Step 3: Inspect the generated SQL**

Open the file at `packages/db/prisma/migrations/<timestamp>_phase4_diagrams/migration.sql`. Confirm it contains `CREATE TYPE "DiagramKind"`, `CREATE TABLE "Diagram"`, `ALTER TABLE "Link" ADD COLUMN "targetDiagramId"`, and the three indexes.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Diagram model and extend Link for diagram targets"
```

---

## Task 2: Shared zod schemas and slug helper for diagrams

**Files:**
- Create: `packages/shared/src/diagrams.ts`
- Create: `packages/shared/src/diagrams.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/diagrams.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DiagramKind,
  diagramCreateSchema,
  diagramPatchSchema,
  slugifyDiagramTitle,
} from './diagrams';

describe('DiagramKind', () => {
  it('exposes DRAWIO and BPMN values', () => {
    expect(DiagramKind.options).toEqual(['DRAWIO', 'BPMN']);
  });
});

describe('diagramCreateSchema', () => {
  it('accepts a valid drawio payload', () => {
    const r = diagramCreateSchema.parse({
      vaultId: 'v1',
      kind: 'DRAWIO',
      title: 'My flow',
    });
    expect(r.title).toBe('My flow');
  });

  it('rejects an empty title', () => {
    expect(() =>
      diagramCreateSchema.parse({ vaultId: 'v1', kind: 'BPMN', title: '' }),
    ).toThrow();
  });
});

describe('diagramPatchSchema', () => {
  it('allows partial updates', () => {
    expect(diagramPatchSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
  });

  it('caps xml length at 2MB', () => {
    const big = 'a'.repeat(2 * 1024 * 1024 + 1);
    expect(() => diagramPatchSchema.parse({ xml: big })).toThrow();
  });
});

describe('slugifyDiagramTitle', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugifyDiagramTitle('My Flow Chart')).toBe('my-flow-chart');
  });

  it('strips non-url-safe chars', () => {
    expect(slugifyDiagramTitle('Café & co!')).toBe('cafe-co');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @km/shared test -- diagrams`
Expected: FAIL with "Cannot find module './diagrams'".

- [ ] **Step 3: Implement `diagrams.ts`**

Create `packages/shared/src/diagrams.ts`:

```ts
import { z } from 'zod';

export const DiagramKind = z.enum(['DRAWIO', 'BPMN']);
export type DiagramKind = z.infer<typeof DiagramKind>;

const MAX_XML_BYTES = 2 * 1024 * 1024;

export const diagramCreateSchema = z.object({
  vaultId: z.string().min(1),
  folderId: z.string().min(1).optional(),
  kind: DiagramKind,
  title: z.string().min(1).max(200),
});
export type DiagramCreateInput = z.infer<typeof diagramCreateSchema>;

export const diagramPatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    folderId: z.string().min(1).nullable().optional(),
    xml: z.string().max(MAX_XML_BYTES).optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .strict();
export type DiagramPatchInput = z.infer<typeof diagramPatchSchema>;

export function slugifyDiagramTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: Re-export from the package index**

Edit `packages/shared/src/index.ts`, append:

```ts
export {
  DiagramKind,
  diagramCreateSchema,
  diagramPatchSchema,
  slugifyDiagramTitle,
} from './diagrams';
export type { DiagramCreateInput, DiagramPatchInput } from './diagrams';
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @km/shared test -- diagrams`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/diagrams.ts packages/shared/src/diagrams.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add diagram zod schemas and slug helper"
```

---

## Task 3: Vendor drawio static assets

**Files:**
- Create: `scripts/vendor-drawio.sh`
- Create: `apps/web/public/drawio/VERSION`
- Create: `apps/web/public/drawio/...` (copied tree)

- [ ] **Step 1: Write the vendor script**

Create `scripts/vendor-drawio.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SRC="${DRAWIO_SRC:-/home/jonny/drawio}"
DEST="apps/web/public/drawio"

if [[ ! -d "$SRC/src/main/webapp" ]]; then
  echo "drawio source not found at $SRC" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"

cp -R "$SRC/src/main/webapp/index.html"       "$DEST/index.html"
cp -R "$SRC/src/main/webapp/js"                "$DEST/js"
cp -R "$SRC/src/main/webapp/styles"            "$DEST/styles"
cp -R "$SRC/src/main/webapp/images"            "$DEST/images"
cp -R "$SRC/src/main/webapp/shapes"            "$DEST/shapes"
cp -R "$SRC/src/main/webapp/stencils"          "$DEST/stencils"
cp -R "$SRC/src/main/webapp/resources"         "$DEST/resources"
cp -R "$SRC/src/main/webapp/mxgraph"           "$DEST/mxgraph"
cp -R "$SRC/src/main/webapp/plugins"           "$DEST/plugins"
cp -R "$SRC/src/main/webapp/math4"             "$DEST/math4"
cp -R "$SRC/src/main/webapp/favicon.ico"       "$DEST/favicon.ico"

SHA=$(git -C "$SRC" rev-parse HEAD)
echo "$SHA" > "$DEST/VERSION"
echo "vendored drawio $SHA into $DEST"
```

Make it executable:

```bash
chmod +x scripts/vendor-drawio.sh
```

- [ ] **Step 2: Run the script**

Run: `./scripts/vendor-drawio.sh`
Expected: "vendored drawio <sha> into apps/web/public/drawio".

- [ ] **Step 3: Sanity-check the copy**

Run: `ls apps/web/public/drawio | sort`
Expected output contains: `VERSION`, `favicon.ico`, `images`, `index.html`, `js`, `math4`, `mxgraph`, `plugins`, `resources`, `shapes`, `stencils`, `styles`.

- [ ] **Step 4: Check `index.html` responds to embed mode**

Run: `grep -c 'urlParams' apps/web/public/drawio/index.html`
Expected: a count greater than 0 (drawio reads `embed=1` from the URL query).

- [ ] **Step 5: Commit**

```bash
git add scripts/vendor-drawio.sh apps/web/public/drawio
git commit -m "chore(web): vendor drawio webapp under public/drawio"
```

---

## Task 4: Create @km/diagrams workspace package with blank stubs

**Files:**
- Create: `packages/diagrams/package.json`
- Create: `packages/diagrams/tsconfig.json`
- Create: `packages/diagrams/src/index.ts`
- Create: `packages/diagrams/src/drawio/blankDrawio.ts`
- Create: `packages/diagrams/src/bpmn/blankBpmn.ts`
- Create: `packages/diagrams/src/bpmn/stub.test.ts`

- [ ] **Step 1: Create `packages/diagrams/package.json`**

```json
{
  "name": "@km/diagrams",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "bpmn-js": "^17.9.0",
    "bpmn-moddle": "^9.0.1"
  },
  "peerDependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/diagrams/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write the BPMN stub test**

Create `packages/diagrams/src/bpmn/stub.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import BpmnModdle from 'bpmn-moddle';
import { blankBpmn } from './blankBpmn';

describe('blankBpmn', () => {
  it('is parseable by bpmn-moddle', async () => {
    const moddle = new BpmnModdle();
    const { rootElement, warnings } = await moddle.fromXML(blankBpmn());
    expect(warnings).toEqual([]);
    expect(rootElement.$type).toBe('bpmn:Definitions');
  });
});
```

- [ ] **Step 4: Create the stub helpers**

Create `packages/diagrams/src/bpmn/blankBpmn.ts`:

```ts
export function blankBpmn(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1" />
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
```

Create `packages/diagrams/src/drawio/blankDrawio.ts`:

```ts
export function blankDrawio(): string {
  return `<mxfile host="app.diagrams.net" type="device">
  <diagram id="diagram-1" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}
```

- [ ] **Step 5: Create the package index**

Create `packages/diagrams/src/index.ts`:

```ts
export { blankDrawio } from './drawio/blankDrawio';
export { blankBpmn } from './bpmn/blankBpmn';
```

- [ ] **Step 6: Install and run the test**

Run: `pnpm install`
Then: `pnpm --filter @km/diagrams test`
Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add packages/diagrams pnpm-lock.yaml
git commit -m "feat(diagrams): add @km/diagrams package with drawio and bpmn stubs"
```

---

## Task 5: drawio postMessage bridge with origin guard

**Files:**
- Create: `packages/diagrams/src/drawio/postMessageBridge.ts`
- Create: `packages/diagrams/src/drawio/postMessageBridge.test.ts`
- Modify: `packages/diagrams/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/diagrams/src/drawio/postMessageBridge.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { parseDrawioEvent, buildLoadAction, buildStatusAction } from './postMessageBridge';

describe('parseDrawioEvent', () => {
  it('parses an init event', () => {
    expect(parseDrawioEvent('{"event":"init"}')).toEqual({ event: 'init' });
  });

  it('parses a save event with xml', () => {
    expect(parseDrawioEvent('{"event":"save","xml":"<x/>"}')).toEqual({
      event: 'save',
      xml: '<x/>',
    });
  });

  it('returns null for an unknown event', () => {
    expect(parseDrawioEvent('{"event":"other"}')).toBeNull();
  });

  it('returns null for non-JSON data', () => {
    expect(parseDrawioEvent('not-json')).toBeNull();
  });
});

describe('buildLoadAction', () => {
  it('returns a JSON string with load action and xml', () => {
    const msg = buildLoadAction('<mxfile/>');
    expect(JSON.parse(msg)).toEqual({ action: 'load', xml: '<mxfile/>', autosave: 1 });
  });
});

describe('buildStatusAction', () => {
  it('returns a JSON string with status action', () => {
    expect(JSON.parse(buildStatusAction(false))).toEqual({
      action: 'status',
      modified: false,
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter @km/diagrams test -- postMessageBridge`
Expected: FAIL with "Cannot find module './postMessageBridge'".

- [ ] **Step 3: Implement the bridge**

Create `packages/diagrams/src/drawio/postMessageBridge.ts`:

```ts
export type DrawioEvent =
  | { event: 'init' }
  | { event: 'save'; xml: string }
  | { event: 'exit' }
  | { event: 'configure' };

export function parseDrawioEvent(raw: unknown): DrawioEvent | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  switch (obj.event) {
    case 'init':
    case 'exit':
    case 'configure':
      return { event: obj.event };
    case 'save':
      if (typeof obj.xml === 'string') {
        return { event: 'save', xml: obj.xml };
      }
      return null;
    default:
      return null;
  }
}

export function buildLoadAction(xml: string): string {
  return JSON.stringify({ action: 'load', xml, autosave: 1 });
}

export function buildStatusAction(modified: boolean): string {
  return JSON.stringify({ action: 'status', modified });
}

export function buildConfigureAction(config: Record<string, unknown> = {}): string {
  return JSON.stringify({ action: 'configure', config });
}

export function isSameOrigin(eventOrigin: string, hostOrigin: string): boolean {
  return eventOrigin === hostOrigin;
}
```

- [ ] **Step 4: Re-export from package index**

Edit `packages/diagrams/src/index.ts`:

```ts
export { blankDrawio } from './drawio/blankDrawio';
export { blankBpmn } from './bpmn/blankBpmn';
export {
  parseDrawioEvent,
  buildLoadAction,
  buildStatusAction,
  buildConfigureAction,
  isSameOrigin,
} from './drawio/postMessageBridge';
export type { DrawioEvent } from './drawio/postMessageBridge';
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @km/diagrams test -- postMessageBridge`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add packages/diagrams/src/drawio packages/diagrams/src/index.ts
git commit -m "feat(diagrams): add drawio postMessage bridge with origin guard"
```

---

## Task 6: DrawioFrame React component

**Files:**
- Create: `packages/diagrams/src/drawio/DrawioFrame.tsx`
- Modify: `packages/diagrams/src/index.ts`

- [ ] **Step 1: Implement `DrawioFrame.tsx`**

Create `packages/diagrams/src/drawio/DrawioFrame.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  parseDrawioEvent,
  buildLoadAction,
  buildStatusAction,
  buildConfigureAction,
  isSameOrigin,
} from './postMessageBridge';

export interface DrawioFrameProps {
  xml: string;
  onSave: (xml: string) => Promise<void>;
  onExit?: () => void;
  embedUrl?: string;
}

const DEFAULT_EMBED_URL =
  '/drawio/?embed=1&proto=json&spin=1&modified=unsavedChanges&saveAndExit=0&noSaveBtn=0&noExitBtn=1&ui=atlas';

export function DrawioFrame({ xml, onSave, onExit, embedUrl }: DrawioFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const hostOrigin = window.location.origin;
    const iframe = iframeRef.current;

    function postToIframe(message: string) {
      iframe?.contentWindow?.postMessage(message, hostOrigin);
    }

    async function onMessage(event: MessageEvent) {
      if (!isSameOrigin(event.origin, hostOrigin)) return;
      const parsed = parseDrawioEvent(event.data);
      if (!parsed) return;
      switch (parsed.event) {
        case 'init':
          postToIframe(buildLoadAction(xml));
          setLoaded(true);
          return;
        case 'save':
          try {
            await onSave(parsed.xml);
            postToIframe(buildStatusAction(false));
          } catch (err) {
            console.error('drawio save failed', err);
          }
          return;
        case 'configure':
          postToIframe(buildConfigureAction({}));
          return;
        case 'exit':
          onExit?.();
          return;
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [xml, onSave, onExit]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!loaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          Loading diagram editor...
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="drawio editor"
        src={embedUrl ?? DEFAULT_EMBED_URL}
        style={{ width: '100%', height: '100%', border: '0' }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Re-export from package index**

Edit `packages/diagrams/src/index.ts` to append:

```ts
export { DrawioFrame } from './drawio/DrawioFrame';
export type { DrawioFrameProps } from './drawio/DrawioFrame';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/diagrams typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/diagrams/src/drawio/DrawioFrame.tsx packages/diagrams/src/index.ts
git commit -m "feat(diagrams): add DrawioFrame react component"
```

---

## Task 7: BpmnCanvas React component

**Files:**
- Create: `packages/diagrams/src/bpmn/BpmnCanvas.tsx`
- Modify: `packages/diagrams/src/index.ts`

- [ ] **Step 1: Implement `BpmnCanvas.tsx`**

Create `packages/diagrams/src/bpmn/BpmnCanvas.tsx`:

```tsx
import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';

export interface BpmnCanvasHandle {
  save(): Promise<string>;
}

export interface BpmnCanvasProps {
  xml: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export const BpmnCanvas = forwardRef<BpmnCanvasHandle, BpmnCanvasProps>(
  function BpmnCanvas({ xml, onDirtyChange }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const modelerRef = useRef<BpmnModeler | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;
      const modeler = new BpmnModeler({ container: containerRef.current });
      modelerRef.current = modeler;

      modeler.importXML(xml).catch((err) => {
        console.error('bpmn import failed', err);
      });

      const listener = () => onDirtyChange?.(true);
      modeler.on('commandStack.changed', listener);

      return () => {
        modeler.off('commandStack.changed', listener);
        modeler.destroy();
        modelerRef.current = null;
      };
    }, [xml, onDirtyChange]);

    useImperativeHandle(
      ref,
      () => ({
        async save() {
          const modeler = modelerRef.current;
          if (!modeler) throw new Error('bpmn modeler not ready');
          const { xml: out } = await modeler.saveXML({ format: true });
          if (!out) throw new Error('bpmn saveXML returned empty');
          return out;
        },
      }),
      [],
    );

    return (
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        data-testid="bpmn-canvas"
      />
    );
  },
);
```

- [ ] **Step 2: Re-export from package index**

Append to `packages/diagrams/src/index.ts`:

```ts
export { BpmnCanvas } from './bpmn/BpmnCanvas';
export type { BpmnCanvasHandle, BpmnCanvasProps } from './bpmn/BpmnCanvas';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @km/diagrams typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/diagrams/src/bpmn/BpmnCanvas.tsx packages/diagrams/src/index.ts
git commit -m "feat(diagrams): add BpmnCanvas react component"
```

---

## Task 8: POST /api/diagrams route

**Files:**
- Create: `apps/web/src/app/api/diagrams/route.ts`
- Create: `apps/web/test/api/diagrams.test.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add `@km/diagrams` as a dep**

Edit `apps/web/package.json` dependencies:

```json
"@km/diagrams": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing integration test**

Create `apps/web/test/api/diagrams.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/diagrams/route';
import { createTestUserAndVault, asAuthedRequest, resetDb } from '../helpers';

describe('POST /api/diagrams', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a drawio diagram with a blank stub', async () => {
    const { userId, vaultId } = await createTestUserAndVault();
    const req = asAuthedRequest(userId, 'POST', '/api/diagrams', {
      vaultId,
      kind: 'DRAWIO',
      title: 'My Flow',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe('DRAWIO');
    expect(body.title).toBe('My Flow');
    expect(body.slug).toBe('my-flow');
    expect(body.xml).toContain('<mxfile');
  });

  it('rejects when the caller lacks vault access', async () => {
    const { userId: owner, vaultId } = await createTestUserAndVault();
    const { userId: other } = await createTestUserAndVault();
    const req = asAuthedRequest(other, 'POST', '/api/diagrams', {
      vaultId,
      kind: 'BPMN',
      title: 'Nope',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    void owner;
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm --filter web test -- diagrams`
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement the route**

Create `apps/web/src/app/api/diagrams/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { assertCanAccessVault } from '@/lib/access';
import { prisma } from '@/lib/db';
import { diagramCreateSchema, slugifyDiagramTitle } from '@km/shared';
import { blankDrawio, blankBpmn } from '@km/diagrams';

export async function POST(req: Request) {
  const userId = await requireUserId();
  const json = await req.json();
  const input = diagramCreateSchema.parse(json);

  await assertCanAccessVault(userId, input.vaultId, 'MEMBER');

  const baseSlug = slugifyDiagramTitle(input.title) || 'diagram';
  const slug = await uniqueDiagramSlug(input.vaultId, baseSlug);
  const xml = input.kind === 'DRAWIO' ? blankDrawio() : blankBpmn();

  const diagram = await prisma.diagram.create({
    data: {
      vaultId: input.vaultId,
      folderId: input.folderId,
      kind: input.kind,
      title: input.title,
      slug,
      xml,
      createdById: userId,
      updatedById: userId,
    },
  });

  return NextResponse.json(diagram, { status: 201 });
}

async function uniqueDiagramSlug(vaultId: string, base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (
    await prisma.diagram.findUnique({ where: { vaultId_slug: { vaultId, slug } } })
  ) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter web test -- diagrams`
Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/app/api/diagrams apps/web/test/api/diagrams.test.ts pnpm-lock.yaml
git commit -m "feat(web): add POST /api/diagrams route"
```

---

## Task 9: GET/PATCH/DELETE /api/diagrams/:id route

**Files:**
- Create: `apps/web/src/app/api/diagrams/[id]/route.ts`
- Modify: `apps/web/test/api/diagrams.test.ts`

- [ ] **Step 1: Extend the test file**

Append to `apps/web/test/api/diagrams.test.ts`:

```ts
import { GET, PATCH, DELETE } from '@/app/api/diagrams/[id]/route';

describe('GET /api/diagrams/:id', () => {
  it('returns the diagram for a member', async () => {
    const { userId, vaultId } = await createTestUserAndVault();
    const created = await POST(
      asAuthedRequest(userId, 'POST', '/api/diagrams', {
        vaultId,
        kind: 'BPMN',
        title: 'P',
      }),
    );
    const { id } = await created.json();
    const res = await GET(
      asAuthedRequest(userId, 'GET', `/api/diagrams/${id}`),
      { params: { id } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(id);
  });
});

describe('PATCH /api/diagrams/:id', () => {
  it('updates xml and bumps updatedAt', async () => {
    const { userId, vaultId } = await createTestUserAndVault();
    const created = await POST(
      asAuthedRequest(userId, 'POST', '/api/diagrams', {
        vaultId,
        kind: 'DRAWIO',
        title: 'D',
      }),
    );
    const d = await created.json();
    const res = await PATCH(
      asAuthedRequest(userId, 'PATCH', `/api/diagrams/${d.id}`, {
        xml: '<mxfile x="1"/>',
      }),
      { params: { id: d.id } },
    );
    expect(res.status).toBe(200);
    const patched = await res.json();
    expect(patched.xml).toBe('<mxfile x="1"/>');
    expect(new Date(patched.updatedAt).getTime()).toBeGreaterThan(
      new Date(d.updatedAt).getTime(),
    );
  });

  it('returns 409 on stale expectedUpdatedAt', async () => {
    const { userId, vaultId } = await createTestUserAndVault();
    const d = await (
      await POST(
        asAuthedRequest(userId, 'POST', '/api/diagrams', {
          vaultId,
          kind: 'DRAWIO',
          title: 'D',
        }),
      )
    ).json();
    const res = await PATCH(
      asAuthedRequest(userId, 'PATCH', `/api/diagrams/${d.id}`, {
        xml: '<x/>',
        expectedUpdatedAt: '1970-01-01T00:00:00.000Z',
      }),
      { params: { id: d.id } },
    );
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/diagrams/:id', () => {
  it('deletes the diagram', async () => {
    const { userId, vaultId } = await createTestUserAndVault();
    const d = await (
      await POST(
        asAuthedRequest(userId, 'POST', '/api/diagrams', {
          vaultId,
          kind: 'BPMN',
          title: 'X',
        }),
      )
    ).json();
    const res = await DELETE(
      asAuthedRequest(userId, 'DELETE', `/api/diagrams/${d.id}`),
      { params: { id: d.id } },
    );
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter web test -- diagrams`
Expected: FAIL with "Cannot find module './[id]/route'".

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/diagrams/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { assertCanAccessVault } from '@/lib/access';
import { prisma } from '@/lib/db';
import { diagramPatchSchema, slugifyDiagramTitle } from '@km/shared';

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const userId = await requireUserId();
  const diagram = await prisma.diagram.findUnique({ where: { id: params.id } });
  if (!diagram) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await assertCanAccessVault(userId, diagram.vaultId, 'MEMBER');
  return NextResponse.json(diagram);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await requireUserId();
  const input = diagramPatchSchema.parse(await req.json());
  const diagram = await prisma.diagram.findUnique({ where: { id: params.id } });
  if (!diagram) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await assertCanAccessVault(userId, diagram.vaultId, 'MEMBER');

  if (
    input.expectedUpdatedAt &&
    new Date(input.expectedUpdatedAt).getTime() !== diagram.updatedAt.getTime()
  ) {
    return NextResponse.json({ error: 'stale' }, { status: 409 });
  }

  const data: Record<string, unknown> = { updatedById: userId };
  if (input.title) {
    data.title = input.title;
    data.slug = await uniqueDiagramSlug(
      diagram.vaultId,
      slugifyDiagramTitle(input.title) || 'diagram',
      diagram.id,
    );
  }
  if (input.folderId !== undefined) data.folderId = input.folderId;
  if (input.xml !== undefined) {
    data.xml = input.xml;
    data.contentUpdatedAt = new Date();
  }

  const updated = await prisma.diagram.update({
    where: { id: diagram.id },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const userId = await requireUserId();
  const diagram = await prisma.diagram.findUnique({ where: { id: params.id } });
  if (!diagram) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await assertCanAccessVault(userId, diagram.vaultId, 'MEMBER');
  await prisma.diagram.delete({ where: { id: diagram.id } });
  return new NextResponse(null, { status: 204 });
}

async function uniqueDiagramSlug(
  vaultId: string,
  base: string,
  excludeId: string,
): Promise<string> {
  let slug = base;
  let n = 1;
  while (true) {
    const existing = await prisma.diagram.findUnique({
      where: { vaultId_slug: { vaultId, slug } },
    });
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web test -- diagrams`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/diagrams/\[id\] apps/web/test/api/diagrams.test.ts
git commit -m "feat(web): add GET/PATCH/DELETE /api/diagrams/:id"
```

---

## Task 10: Extend vault tree endpoint to include diagrams

**Files:**
- Modify: `apps/web/src/app/api/vaults/[id]/tree/route.ts`
- Create: `apps/web/test/api/tree-diagrams.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/api/tree-diagrams.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/vaults/[id]/tree/route';
import { POST as createDiagram } from '@/app/api/diagrams/route';
import { createTestUserAndVault, asAuthedRequest, resetDb } from '../helpers';

describe('GET /api/vaults/:id/tree with diagrams', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('includes diagrams in the items array tagged by kind', async () => {
    const { userId, vaultId } = await createTestUserAndVault();
    await createDiagram(
      asAuthedRequest(userId, 'POST', '/api/diagrams', {
        vaultId,
        kind: 'DRAWIO',
        title: 'Flow',
      }),
    );
    await createDiagram(
      asAuthedRequest(userId, 'POST', '/api/diagrams', {
        vaultId,
        kind: 'BPMN',
        title: 'Proc',
      }),
    );
    const res = await GET(
      asAuthedRequest(userId, 'GET', `/api/vaults/${vaultId}/tree`),
      { params: { id: vaultId } },
    );
    const body = await res.json();
    const kinds = body.items.map((i: { kind: string }) => i.kind).sort();
    expect(kinds).toEqual(['bpmn', 'drawio']);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm --filter web test -- tree-diagrams`
Expected: FAIL because existing route does not return `items`.

- [ ] **Step 3: Update the tree route**

Edit `apps/web/src/app/api/vaults/[id]/tree/route.ts`. Replace the response builder so that it returns:

```ts
const [folders, notes, diagrams] = await Promise.all([
  prisma.folder.findMany({ where: { vaultId }, orderBy: { path: 'asc' } }),
  prisma.note.findMany({
    where: { vaultId },
    select: { id: true, title: true, folderId: true, updatedAt: true },
    orderBy: { title: 'asc' },
  }),
  prisma.diagram.findMany({
    where: { vaultId },
    select: { id: true, title: true, folderId: true, kind: true, updatedAt: true },
    orderBy: { title: 'asc' },
  }),
]);

const items = [
  ...notes.map((n) => ({ kind: 'note' as const, ...n })),
  ...diagrams.map((d) => ({
    kind: d.kind === 'DRAWIO' ? ('drawio' as const) : ('bpmn' as const),
    id: d.id,
    title: d.title,
    folderId: d.folderId,
    updatedAt: d.updatedAt,
  })),
];

return NextResponse.json({ folders, items, notes });
```

Keep the original `notes` key for backwards compatibility as documented in the spec.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web test -- tree-diagrams`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/vaults apps/web/test/api/tree-diagrams.test.ts
git commit -m "feat(web): include diagrams in vault tree response"
```

---

## Task 11: Wiki-link resolution across notes and diagrams

**Files:**
- Modify: `apps/web/src/lib/links.ts`
- Modify: `apps/web/src/lib/links.test.ts`
- Create: `apps/web/src/app/api/links/resolve/route.ts`
- Create: `apps/web/src/app/api/diagrams/[id]/backlinks/route.ts`

- [ ] **Step 1: Add failing tests for diagram resolution**

Append to `apps/web/src/lib/links.test.ts`:

```ts
import { resolveLinkTargets } from './links';

describe('resolveLinkTargets', () => {
  it('resolves a title to a diagram when no matching note exists', async () => {
    const { vaultId } = await createTestUserAndVault();
    await prisma.diagram.create({
      data: {
        vaultId,
        kind: 'DRAWIO',
        title: 'Architecture',
        slug: 'architecture',
        xml: '<mxfile/>',
        createdById: 'u',
        updatedById: 'u',
      },
    });
    const r = await resolveLinkTargets(prisma, vaultId, ['Architecture']);
    expect(r[0]).toMatchObject({ title: 'Architecture', kind: 'diagram' });
  });

  it('prefers note over diagram when both exist', async () => {
    const { vaultId, userId } = await createTestUserAndVault();
    await prisma.note.create({
      data: {
        vaultId,
        title: 'Overview',
        slug: 'overview',
        content: '',
        createdById: userId,
        updatedById: userId,
      },
    });
    await prisma.diagram.create({
      data: {
        vaultId,
        kind: 'BPMN',
        title: 'Overview',
        slug: 'overview-d',
        xml: '<x/>',
        createdById: userId,
        updatedById: userId,
      },
    });
    const r = await resolveLinkTargets(prisma, vaultId, ['Overview']);
    expect(r[0].kind).toBe('note');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web test -- links`
Expected: FAIL (export missing).

- [ ] **Step 3: Extend `apps/web/src/lib/links.ts`**

Add:

```ts
export type ResolvedTarget =
  | { title: string; kind: 'note'; id: string }
  | { title: string; kind: 'diagram'; id: string }
  | { title: string; kind: null; id: null };

export async function resolveLinkTargets(
  tx: typeof prisma,
  vaultId: string,
  titles: string[],
): Promise<ResolvedTarget[]> {
  if (titles.length === 0) return [];
  const [notes, diagrams] = await Promise.all([
    tx.note.findMany({
      where: { vaultId, title: { in: titles } },
      select: { id: true, title: true },
    }),
    tx.diagram.findMany({
      where: { vaultId, title: { in: titles } },
      select: { id: true, title: true },
    }),
  ]);
  const noteByTitle = new Map(notes.map((n) => [n.title, n.id]));
  const diagramByTitle = new Map(diagrams.map((d) => [d.title, d.id]));
  return titles.map((t) => {
    if (noteByTitle.has(t)) return { title: t, kind: 'note', id: noteByTitle.get(t)! };
    if (diagramByTitle.has(t))
      return { title: t, kind: 'diagram', id: diagramByTitle.get(t)! };
    return { title: t, kind: null, id: null };
  });
}
```

Update `recomputeLinks` to call `resolveLinkTargets` and set `targetNoteId` or `targetDiagramId` based on the resolved `kind`, leaving both null when unresolved.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web test -- links`
Expected: PASS including tie-break case.

- [ ] **Step 5: Add the `GET /api/links/resolve` route**

Create `apps/web/src/app/api/links/resolve/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { assertCanAccessVault } from '@/lib/access';
import { prisma } from '@/lib/db';
import { resolveLinkTargets } from '@/lib/links';

export async function GET(req: Request) {
  const userId = await requireUserId();
  const url = new URL(req.url);
  const vaultId = url.searchParams.get('vaultId');
  const title = url.searchParams.get('title');
  if (!vaultId || !title) {
    return NextResponse.json({ error: 'missing vaultId or title' }, { status: 400 });
  }
  await assertCanAccessVault(userId, vaultId, 'MEMBER');
  const [target] = await resolveLinkTargets(prisma, vaultId, [title]);
  return NextResponse.json(target);
}
```

- [ ] **Step 6: Add the diagram backlinks route**

Create `apps/web/src/app/api/diagrams/[id]/backlinks/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { assertCanAccessVault } from '@/lib/access';
import { prisma } from '@/lib/db';

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const userId = await requireUserId();
  const diagram = await prisma.diagram.findUnique({ where: { id: params.id } });
  if (!diagram) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await assertCanAccessVault(userId, diagram.vaultId, 'MEMBER');
  const links = await prisma.link.findMany({
    where: { targetDiagramId: diagram.id },
    include: { sourceNote: { select: { id: true, title: true, slug: true } } },
  });
  return NextResponse.json({ links });
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/links.ts apps/web/src/lib/links.test.ts apps/web/src/app/api/links apps/web/src/app/api/diagrams/\[id\]/backlinks
git commit -m "feat(web): resolve wiki-links to notes or diagrams with note precedence"
```

---

## Task 12: Diagram page route

**Files:**
- Create: `apps/web/src/app/(app)/vault/[vaultId]/diagram/[diagramId]/page.tsx`
- Create: `apps/web/src/app/(app)/vault/[vaultId]/diagram/[diagramId]/DiagramHost.tsx`

- [ ] **Step 1: Implement the server page**

Create `apps/web/src/app/(app)/vault/[vaultId]/diagram/[diagramId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { requireUserId } from '@/lib/auth';
import { assertCanAccessVault } from '@/lib/access';
import { prisma } from '@/lib/db';
import { DiagramHost } from './DiagramHost';

export default async function DiagramPage({
  params,
}: {
  params: { vaultId: string; diagramId: string };
}) {
  const userId = await requireUserId();
  const diagram = await prisma.diagram.findUnique({
    where: { id: params.diagramId },
  });
  if (!diagram || diagram.vaultId !== params.vaultId) return notFound();
  await assertCanAccessVault(userId, diagram.vaultId, 'MEMBER');

  return (
    <div style={{ height: 'calc(100vh - 3rem)' }}>
      <DiagramHost
        id={diagram.id}
        kind={diagram.kind}
        title={diagram.title}
        xml={diagram.xml}
        updatedAt={diagram.updatedAt.toISOString()}
      />
    </div>
  );
}
```

- [ ] **Step 2: Implement the client host**

Create `apps/web/src/app/(app)/vault/[vaultId]/diagram/[diagramId]/DiagramHost.tsx`:

```tsx
'use client';

import { useCallback, useRef, useState } from 'react';
import { DrawioFrame, BpmnCanvas, type BpmnCanvasHandle } from '@km/diagrams';

export interface DiagramHostProps {
  id: string;
  kind: 'DRAWIO' | 'BPMN';
  title: string;
  xml: string;
  updatedAt: string;
}

export function DiagramHost(props: DiagramHostProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(props.updatedAt);
  const bpmnRef = useRef<BpmnCanvasHandle | null>(null);

  const saveXml = useCallback(
    async (xml: string) => {
      setStatus('saving');
      const res = await fetch(`/api/diagrams/${props.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml, expectedUpdatedAt }),
      });
      if (!res.ok) {
        setStatus('error');
        throw new Error(`save failed: ${res.status}`);
      }
      const body = await res.json();
      setExpectedUpdatedAt(body.updatedAt);
      setStatus('idle');
    },
    [props.id, expectedUpdatedAt],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '0.5rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1 style={{ fontSize: '1rem', margin: 0 }}>{props.title}</h1>
        {props.kind === 'BPMN' && (
          <button
            type="button"
            onClick={async () => {
              const xml = await bpmnRef.current?.save();
              if (xml) await saveXml(xml);
            }}
          >
            Save
          </button>
        )}
        <span aria-live="polite">{status === 'saving' ? 'Saving...' : ''}</span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        {props.kind === 'DRAWIO' ? (
          <DrawioFrame xml={props.xml} onSave={saveXml} />
        ) : (
          <BpmnCanvas ref={bpmnRef} xml={props.xml} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run: `pnpm --filter web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/vault/\[vaultId\]/diagram
git commit -m "feat(web): add diagram page rendering drawio or bpmn host"
```

---

## Task 13: File tree diagrams integration

**Files:**
- Modify: `apps/web/src/components/FileTree.tsx`

- [ ] **Step 1: Extend FileTree rendering**

Update the tree item renderer to accept items with `kind: 'note' | 'drawio' | 'bpmn'`. For each item:

- `note` links to `/vault/${vaultId}/note/${id}` and renders a document icon.
- `drawio` links to `/vault/${vaultId}/diagram/${id}` and renders a flowchart icon.
- `bpmn` links to the same diagram route and renders a process icon.

Add two new context menu entries on folders:

```tsx
<MenuItem
  onSelect={async () => {
    const r = await fetch('/api/diagrams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vaultId,
        folderId,
        kind: 'DRAWIO',
        title: 'Untitled diagram',
      }),
    });
    const d = await r.json();
    router.push(`/vault/${vaultId}/diagram/${d.id}`);
  }}
>
  New drawio diagram
</MenuItem>
<MenuItem
  onSelect={async () => {
    const r = await fetch('/api/diagrams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vaultId,
        folderId,
        kind: 'BPMN',
        title: 'Untitled process',
      }),
    });
    const d = await r.json();
    router.push(`/vault/${vaultId}/diagram/${d.id}`);
  }}
>
  New BPMN diagram
</MenuItem>
```

Adjust the tree data source to read from `items` rather than `notes`, falling back to `notes` while the backend still returns both.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/FileTree.tsx
git commit -m "feat(web): render diagrams in file tree and add create menu entries"
```

---

## Task 14: CodeMirror wiki-link click navigates via resolver

**Files:**
- Modify: `packages/editor/src/wikiLinks.ts`
- Modify: `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`

- [ ] **Step 1: Change the click handler**

In the CodeMirror wiki-link extension, replace the hard-coded `/vault/${vaultId}/note/${title}` navigation with a call to `/api/links/resolve`:

```ts
const target = await fetch(
  `/api/links/resolve?vaultId=${encodeURIComponent(vaultId)}&title=${encodeURIComponent(title)}`,
).then((r) => r.json());

if (target.kind === 'note') {
  router.push(`/vault/${vaultId}/note/${target.id}`);
} else if (target.kind === 'diagram') {
  router.push(`/vault/${vaultId}/diagram/${target.id}`);
} else {
  router.push(`/vault/${vaultId}/new?title=${encodeURIComponent(title)}`);
}
```

The `router.push` function is injected via the extension's `onLinkClick` prop configured from `apps/web/src/app/(app)/vault/[vaultId]/note/[noteId]/page.tsx`.

- [ ] **Step 2: Typecheck both packages**

Run: `pnpm --filter @km/editor typecheck && pnpm --filter web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/wikiLinks.ts apps/web/src/app/\(app\)/vault/\[vaultId\]/note/\[noteId\]/page.tsx
git commit -m "feat(editor): resolve wiki-link clicks via /api/links/resolve"
```

---

## Task 15: Export worker writes diagrams into the archive

**Files:**
- Modify: `apps/worker/src/export.ts`
- Modify: `apps/worker/test/export.test.ts`

- [ ] **Step 1: Extend the export test**

Append to `apps/worker/test/export.test.ts`:

```ts
it('writes drawio and bpmn files into the archive', async () => {
  const { userId, vaultId } = await createTestUserAndVault();
  await prisma.diagram.create({
    data: {
      vaultId,
      kind: 'DRAWIO',
      title: 'Flow',
      slug: 'flow',
      xml: '<mxfile id="x"/>',
      createdById: userId,
      updatedById: userId,
    },
  });
  await prisma.diagram.create({
    data: {
      vaultId,
      kind: 'BPMN',
      title: 'Proc',
      slug: 'proc',
      xml: '<bpmn/>',
      createdById: userId,
      updatedById: userId,
    },
  });

  const { archivePath } = await runExport(vaultId, userId);
  const entries = await listZipEntries(archivePath);
  expect(entries).toContain('flow.drawio');
  expect(entries).toContain('proc.bpmn');
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter worker test -- export`
Expected: FAIL (entries missing).

- [ ] **Step 3: Extend the export writer**

In `apps/worker/src/export.ts`, after writing note files, add:

```ts
const diagrams = await prisma.diagram.findMany({
  where: { vaultId },
  select: {
    id: true,
    kind: true,
    slug: true,
    xml: true,
    folder: { select: { path: true } },
  },
});

for (const d of diagrams) {
  const ext = d.kind === 'DRAWIO' ? '.drawio' : '.bpmn';
  const folderPath = d.folder?.path ?? '';
  const relPath = folderPath ? `${folderPath}/${d.slug}${ext}` : `${d.slug}${ext}`;
  await writeToArchive(relPath, d.xml);
}
```

Collision handling reuses the same helper as notes.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter worker test -- export`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/export.ts apps/worker/test/export.test.ts
git commit -m "feat(worker): include diagrams in vault export archive"
```

---

## Task 16: Playwright E2E for drawio editing

**Files:**
- Create: `apps/web/playwright/diagrams-drawio.spec.ts`

- [ ] **Step 1: Write the E2E**

Create `apps/web/playwright/diagrams-drawio.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { signUpAndLogIn } from './helpers';

test('create, edit, and persist a drawio diagram', async ({ page }) => {
  const { vaultId } = await signUpAndLogIn(page);
  await page.goto(`/vault/${vaultId}`);

  await page.getByRole('button', { name: 'New drawio diagram' }).click();
  await expect(page).toHaveURL(/\/diagram\//);

  const frame = page.frameLocator('iframe[title="drawio editor"]');
  await expect(frame.locator('body')).toBeVisible({ timeout: 20000 });

  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="drawio editor"]');
    iframe?.contentWindow?.postMessage(
      JSON.stringify({
        event: 'save',
        xml:
          '<mxfile><diagram><mxGraphModel><root>' +
          '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
          '<mxCell id="2" value="E2E" vertex="1" parent="1"><mxGeometry x="40" y="40" width="80" height="40"/></mxCell>' +
          '</root></mxGraphModel></diagram></mxfile>',
      }),
      window.location.origin,
    );
  });

  await page.waitForResponse((res) => res.url().includes('/api/diagrams/') && res.request().method() === 'PATCH');

  await page.reload();
  await expect(frame.locator('body')).toBeVisible({ timeout: 20000 });
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm --filter web exec playwright test diagrams-drawio`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/playwright/diagrams-drawio.spec.ts
git commit -m "test(web): e2e drawio create, edit, persist"
```

---

## Task 17: Playwright E2E for BPMN editing

**Files:**
- Create: `apps/web/playwright/diagrams-bpmn.spec.ts`

- [ ] **Step 1: Write the E2E**

Create `apps/web/playwright/diagrams-bpmn.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { signUpAndLogIn } from './helpers';

test('create, edit, and persist a bpmn diagram', async ({ page }) => {
  const { vaultId } = await signUpAndLogIn(page);
  await page.goto(`/vault/${vaultId}`);

  await page.getByRole('button', { name: 'New BPMN diagram' }).click();
  await expect(page).toHaveURL(/\/diagram\//);
  await expect(page.getByTestId('bpmn-canvas')).toBeVisible();

  const startEvent = page.locator('.djs-palette [data-action="create.start-event"]');
  await startEvent.click();
  await page.mouse.click(400, 300);

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForResponse((res) => res.url().includes('/api/diagrams/') && res.request().method() === 'PATCH');

  await page.reload();
  await expect(page.locator('.djs-shape[data-element-id]')).toHaveCount(1, { timeout: 15000 });
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm --filter web exec playwright test diagrams-bpmn`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/playwright/diagrams-bpmn.spec.ts
git commit -m "test(web): e2e bpmn create, edit, persist"
```

---

## Task 18: Playwright E2E for wiki-linking to a diagram

**Files:**
- Create: `apps/web/playwright/diagrams-link.spec.ts`

- [ ] **Step 1: Write the E2E**

Create `apps/web/playwright/diagrams-link.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { signUpAndLogIn } from './helpers';

test('wiki-link from a note navigates to a diagram', async ({ page, request }) => {
  const { vaultId, cookies } = await signUpAndLogIn(page);

  const diagram = await request
    .post('/api/diagrams', {
      data: { vaultId, kind: 'DRAWIO', title: 'My Diagram' },
      headers: { cookie: cookies },
    })
    .then((r) => r.json());

  const note = await request
    .post('/api/notes', {
      data: { vaultId, title: 'Index', content: 'see [[My Diagram]]' },
      headers: { cookie: cookies },
    })
    .then((r) => r.json());

  await page.goto(`/vault/${vaultId}/note/${note.id}`);
  await page.getByRole('link', { name: 'My Diagram' }).click();
  await expect(page).toHaveURL(new RegExp(`/vault/${vaultId}/diagram/${diagram.id}`));
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm --filter web exec playwright test diagrams-link`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/playwright/diagrams-link.spec.ts
git commit -m "test(web): e2e wiki-link navigates from note to diagram"
```

---

## Task 19: Documentation and end-user guide

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/data-model.md`
- Modify: `docs/api.md`
- Modify: `docs/deployment.md`
- Create: `guides/diagrams.md`

- [ ] **Step 1: Update architecture doc**

Add a "Diagrams" section to `docs/architecture.md` covering the new `@km/diagrams` package, the drawio vendoring path, the bpmn-js component, and the extended file tree.

- [ ] **Step 2: Update data model doc**

Add a section describing the `Diagram` model, the `DiagramKind` enum, and the new `Link.targetDiagramId` column including the note-wins precedence rule.

- [ ] **Step 3: Update API doc**

Document `POST/GET/PATCH/DELETE /api/diagrams`, `GET /api/diagrams/search`, `GET /api/diagrams/:id/backlinks`, `GET /api/links/resolve`, and the extended shape of `GET /api/vaults/:id/tree`.

- [ ] **Step 4: Update deployment doc**

Describe the vendored drawio path under `apps/web/public/drawio/`, the `scripts/vendor-drawio.sh` refresh workflow, and confirm that no new environment variables are required.

- [ ] **Step 5: Write the user guide**

Create `guides/diagrams.md`:

```markdown
# Diagrams

This guide covers how to create and edit diagrams in your vault. Two kinds of diagram are supported: drawio flow diagrams for general boxes and arrows, and BPMN diagrams for business process modelling.

## Creating a drawio diagram

Open any folder in your vault, right-click the folder name, and choose "New drawio diagram". A blank editor opens. Add shapes from the left palette, drag them around, and connect them with arrows. Your changes save automatically once you stop editing.

## Creating a BPMN diagram

From the same folder menu, choose "New BPMN diagram". The BPMN editor opens with an empty process. Drag a start event from the palette, add tasks, and connect them with sequence flows. Use the "Save" button at the top of the page whenever you want to persist your changes.

## Linking a diagram from a note

Inside any note, write `[[My Diagram Title]]`. When you click that link, the platform navigates to the matching diagram if it exists. If a note and a diagram share the same title, the note takes precedence, so pick distinct titles when it matters.

## Exporting diagrams

When you export your vault, diagrams appear in the archive as `.drawio` and `.bpmn` files next to your markdown notes, inside the same folder structure. You can open those files in any drawio-compatible or BPMN-compatible tool.
```

- [ ] **Step 6: Commit**

```bash
git add docs/architecture.md docs/data-model.md docs/api.md docs/deployment.md guides/diagrams.md
git commit -m "docs: document Phase 4 diagrams feature"
```

---

## Self-review checklist

- Spec sections map to tasks: Data model (Task 1), shared schemas (Task 2), drawio vendoring (Task 3), `@km/diagrams` package with stubs (Task 4), drawio bridge (Task 5), DrawioFrame (Task 6), BpmnCanvas (Task 7), API routes (Tasks 8 and 9), tree endpoint (Task 10), wiki-link resolution and backlinks (Task 11), diagram page (Task 12), file tree UI (Task 13), CodeMirror click handler (Task 14), export worker (Task 15), E2E drawio (Task 16), E2E bpmn (Task 17), E2E wiki-link (Task 18), docs and guides (Task 19).
- Type consistency verified: `DiagramKind` enum values are `'DRAWIO' | 'BPMN'` in Prisma, zod, and TypeScript across every task. `Diagram` model name is used consistently. `resolveLinkTargets` signature matches between its definition (Task 11) and its callers (Tasks 11 and 14). `BpmnCanvasHandle.save()` returns a `Promise<string>` and is used that way in the page host (Task 12).
- No placeholders: every code-bearing step includes the code. No "similar to", no "TBD".
- Optimistic concurrency and conflict handling are tested (Task 9) and honoured by the client (Task 12).
- Open spec items are flagged as deferred and none block this plan.
