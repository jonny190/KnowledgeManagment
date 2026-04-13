# Phase 4: Diagrams (drawio and bpmn-js)

**Date:** 2026-04-13
**Status:** Approved design, ready for implementation planning
**Sub-project:** 4 of 5 (Diagrams)
**Builds on:** Foundation (Plans A through D) and Phase 2 Realtime, merged to `main`

## Context

Earlier phases delivered a multi-user vault of markdown notes with realtime co-editing, wiki-links, backlinks, attachments, and markdown export. The roadmap always intended diagrams to be first-class citizens of a vault, sitting next to notes in the same folder tree and exporting alongside them.

Phase 4 introduces two diagram editors:

- **drawio** for general flowcharts, architecture sketches, and free-form diagrams, embedded from a self-hosted bundle.
- **bpmn-js** for BPMN 2.0 process diagrams, consumed as an npm package and wrapped in a React component.

Both are treated as distinct file types within a vault, sharing the existing vault access control, file tree, and export worker paths.

Realtime co-editing of diagrams is intentionally out of scope for this phase; diagrams in v1 are single-editor with last-writer-wins, matching the pre-Phase 2 shape of notes. The data model is designed so Phase 5 or a follow-up can layer Yjs on top without reshaping storage.

## Goals

Signed-in users with `MEMBER` or higher access to a vault can:

- Create, rename, move, and delete `.drawio` and `.bpmn` items in any folder of the vault.
- Open a drawio diagram in an embedded editor inside the note page frame and save the XML back to Postgres.
- Open a BPMN diagram in a bpmn-js editor inside the same frame and save the XML back to Postgres.
- See diagrams alongside notes in the file tree, with a distinct icon per kind.
- Link to a diagram from any note via `[[Diagram Title]]`; clicking navigates to the diagram page.
- Export a vault as a zip where diagrams are written as `.drawio` and `.bpmn` files next to `.md` files, preserving folder structure.

Out of scope for this phase:

- Realtime co-editing of diagrams (single editor, optimistic concurrency with updatedAt check).
- Server-side rendering of diagrams to PNG or SVG.
- Linking drawio image attachments into the `Attachment` table (external image references continue to work client-side).
- Inline rendering of a diagram preview inside a markdown note view.
- Diagram templates, custom shape libraries, or custom colour palettes.
- Permissions beyond vault membership.
- Mobile-optimised diagram editing.

## Stack additions

| Concern | Choice |
|---|---|
| drawio runtime | Self-hosted static bundle under `apps/web/public/drawio/` |
| drawio host integration | `postMessage` protocol against an embedded iframe |
| BPMN runtime | `bpmn-js` npm package (with `diagram-js` peer) |
| React wrapper | New package `@km/diagrams` with two components |
| Persistence | Postgres `Diagram` row storing XML as text |
| Auth | Existing `assertCanAccessVault` helper |
| Export | Existing `apps/worker` pg-boss queue |

`bpmn-js` ships its own CSS; we import it from the package entry point inside the component.

## System shape

No new service is introduced. Diagrams add files to existing apps and a new shared package:

```
apps/
├── web/
│   ├── public/drawio/           Self-hosted drawio webapp assets
│   └── src/
│       ├── app/(app)/vault/[vaultId]/diagram/[diagramId]/page.tsx
│       └── app/api/diagrams/...
└── worker/                      Export worker gains diagram writer

packages/
├── db/                          Diagram model + enum + migration
├── shared/                      Diagram zod schemas, link-target helper
├── editor/                      Unchanged
└── diagrams/                    New: DrawioFrame + BpmnCanvas React components
```

The note page and the diagram page are sibling routes. The file tree API returns a unified list of tree nodes that includes both notes and diagrams, each tagged with a `kind` so the client renders the right icon and navigates to the right URL.

## Data model changes

A new `Diagram` model is introduced alongside `Note`. A separate table (rather than a polymorphic column on `Note`) keeps the note hot-path queries unchanged and avoids mixing XML payloads into a markdown-shaped row. A shared `item` view is not necessary for v1 because the only cross-kind path is the file tree, which can `UNION` at query time.

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

Related changes:

- `Vault` gains `diagrams Diagram[]`.
- `Folder` gains `diagrams Diagram[]`.
- `Link` gains an optional `targetDiagramId String?` plus a `TargetDiagram` relation. Exactly one of `targetNoteId` or `targetDiagramId` is set when `resolved = true`; both are null when `resolved = false`.
- `Link.targetTitle` keeps its current role as the raw wiki-link text.

Design notes:

- `slug` is unique per vault across the diagrams table only. Cross-kind title collisions (a note and a diagram with the same title) are allowed at the storage level; wiki-link resolution handles them with an explicit precedence rule below.
- `xml` is stored as `@db.Text`. Typical drawio files are tens of kilobytes; bpmn XML is similar. A soft limit of 2 MB is enforced at the API layer.
- There is no Yjs table for diagrams in this phase. Future realtime work can add `DiagramDoc` mirroring `NoteDoc`.

## drawio embedding strategy

The drawio editor is embedded as an iframe pointing at a self-hosted build shipped inside `apps/web/public/drawio/`. Self-hosting avoids the third-party dependency, keeps traffic inside the Cloudflare proxy, and satisfies the privacy constraint that vault XML never leaves our infrastructure during editing.

**Vendoring:**

- A one-off script `scripts/vendor-drawio.sh` copies the drawio webapp from a pinned upstream commit (local clone at `/home/jonny/drawio/src/main/webapp`) into `apps/web/public/drawio/`. The script records the commit SHA in `apps/web/public/drawio/VERSION` for provenance.
- Only the subset needed for embed mode is copied: `index.html`, `js/`, `styles/`, `images/`, `shapes/`, `stencils/`, `resources/`, `mxgraph/`, `plugins/`, `math4/`. Service worker files are excluded. The bundle size is well under 50 MB uncompressed.
- The copy is committed to the repo so CI and Docker builds do not need the upstream clone.

**Integration:**

- `packages/diagrams/src/drawio/DrawioFrame.tsx` renders an `<iframe>` pointing at `/drawio/?embed=1&proto=json&spin=1&modified=unsavedChanges&saveAndExit=0&noSaveBtn=0&noExitBtn=1&ui=atlas`.
- The host page posts messages through the iframe's `contentWindow`:
  - On `{ event: "init" }` from drawio, host replies with `{ action: "load", xml, autosave: 1 }`.
  - On `{ event: "save", xml }` from drawio, host issues `PATCH /api/diagrams/:id` with the new XML and, on success, replies with `{ action: "status", modified: false }`.
  - On `{ event: "exit" }`, host navigates back to the vault tree.
  - On `{ event: "configure" }`, host replies with `{ action: "configure", config: {} }` for future theming.
- Message origin is validated against `window.location.origin`.
- A skeleton loader is shown until the first `init` message arrives. A toast surfaces save failures.

New drawio items are created with a minimal valid XML stub (a blank `<mxfile>` containing one `<diagram>` with an empty `<mxGraphModel>`), so drawio opens straight into the editor rather than the "create new" wizard.

## bpmn-js component

`packages/diagrams/src/bpmn/BpmnCanvas.tsx` wraps a `BpmnModeler` instance from `bpmn-js/lib/Modeler`. It:

- Creates the modeler against a dedicated `<div ref>` on mount and calls `importXML(xml)` with the stored XML (or a blank BPMN stub for new diagrams).
- Attaches `modeler.on("commandStack.changed", onDirty)` to mark the document dirty.
- Exposes a `save()` method that calls `modeler.saveXML({ format: true })` and resolves with the serialised XML.
- A save button in the page header calls `save()` then `PATCH /api/diagrams/:id`.
- Destroys the modeler in the cleanup function of the effect.
- Imports `bpmn-js/dist/assets/diagram-js.css` and `bpmn-js/dist/assets/bpmn-js.css` at module scope.

The blank BPMN stub is the standard empty `bpmn:Definitions` with a single `bpmn:Process` and no flow nodes.

## API routes

All routes live under `apps/web/src/app/api/diagrams/`. Each route resolves the diagram's `vaultId` and calls `assertCanAccessVault(userId, vaultId, requiredRole)` as the first action after authentication.

```
POST   /api/diagrams                      create { vaultId, folderId?, kind, title }
GET    /api/diagrams/:id                  fetch metadata + xml (MEMBER)
PATCH  /api/diagrams/:id                  update { title?, folderId?, xml?, expectedUpdatedAt? } (MEMBER)
DELETE /api/diagrams/:id                  (MEMBER)
GET    /api/diagrams/search?q=&vaultId=   prefix search on title (MEMBER)
```

- `PATCH` returns `409 Conflict` if `expectedUpdatedAt` is supplied and does not match the stored `updatedAt`, giving optimistic concurrency without a full lock. The drawio and bpmn-js hosts send the value they were last given; a stale client sees the conflict and is told to reload.
- Renames keep `slug` in sync via the same slugify logic used for notes.
- Title changes trigger a background link recompute: all `Link` rows where `targetTitle` equals the old or new title in the same vault are re-resolved. The helper that does this is extended in the wiki-link resolution section below.

The `GET /api/vaults/:id/tree` endpoint is extended to include diagrams:

```jsonc
{
  "folders": [...],
  "items": [
    { "kind": "note",    "id": "...", "title": "...", "folderId": "..." },
    { "kind": "drawio",  "id": "...", "title": "...", "folderId": "..." },
    { "kind": "bpmn",    "id": "...", "title": "...", "folderId": "..." }
  ]
}
```

The previous `notes` key is retained as a deprecated alias populated from the `items` array so existing clients keep working through the deploy window.

## File tree integration

- `apps/web/src/components/FileTree.tsx` renders tree items from `items` (notes and diagrams). Each item picks its icon by `kind`: document for notes, flowchart for drawio, process for bpmn.
- Right-click context menu on a folder gets two new entries: "New drawio diagram" and "New BPMN diagram". They call `POST /api/diagrams` with the corresponding `kind` and a default title, then navigate to the new diagram page.
- Drag-drop move reuses the same `PATCH /api/folders/:id/move` shape, now accepting a typed item reference `{ kind, id }` in the payload.

## Wiki-link resolution to diagrams

`parseWikiLinks` in `packages/shared` is already kind-agnostic: it returns title + alias matches. The resolver that turns a title into a database row is extended.

- A new helper `resolveLinkTargets(prisma, vaultId, titles: string[])` in `apps/web/src/lib/links.ts` returns an array of `{ title, kind, id } | { title, kind: null, id: null }` entries.
- Resolution order when a title exists as both a note and a diagram in the same vault: **note wins**. This matches user intuition that `[[X]]` inside a note most often refers to another note, and keeps existing behaviour untouched.
- `Link` rows store either `targetNoteId` or `targetDiagramId` based on the resolved kind. `resolved` remains `true` when exactly one of the two is set.
- The backlinks panel is extended to query both `targetNoteId = currentId` (on the note page) and `targetDiagramId = currentId` (on the diagram page). A new `GET /api/diagrams/:id/backlinks` mirrors the note endpoint.
- The CodeMirror wiki-link extension in `packages/editor` already decorates links as clickable. Click handling is updated to hit a new `GET /api/links/resolve?vaultId=&title=` endpoint that returns the target kind and id, then navigates to `/vault/:vaultId/note/:id` or `/vault/:vaultId/diagram/:id` accordingly.

## Export worker updates

`apps/worker` gains a diagram writer.

- The existing export job loader is extended to read `Diagram` rows for the vault in the same pass as notes and folders.
- File naming: `<folderPath>/<slug>.drawio` for drawio diagrams, `<folderPath>/<slug>.bpmn` for bpmn diagrams. Path collisions across kinds are resolved by appending `-<shortId>` to the filename, matching the existing policy for note slug collisions.
- Wiki-links inside note markdown are written verbatim; they continue to work when the export is re-imported because the target titles are stable across kinds.
- The zip archive layout mirrors the file tree, with notes and diagrams side by side.
- Scheduled nightly exports continue to include diagrams with no additional configuration.

## Auth

- Every API route calls `assertCanAccessVault` before reading or writing. `MEMBER` suffices for all operations, matching the note policy.
- The drawio iframe and the bpmn-js canvas live inside the authenticated Next.js app, so no token-based handshake is needed. Session cookies cover the iframe fetch of `/drawio/` because it is same-origin.
- `PATCH /api/diagrams/:id` enforces the `vaultId` invariant: the server resolves the diagram and checks access against its stored `vaultId`, ignoring any client-supplied id.

## Deployment

- `apps/web/public/drawio/` is committed to the repo, so the production Docker image already contains it. No new volume is needed.
- `packages/diagrams` is consumed by `apps/web` as a workspace dependency; the existing web Dockerfile picks it up via `pnpm deploy`.
- Cloudflare proxy config is unchanged; all traffic remains HTTPS-at-edge, HTTP internal.
- No new environment variables.

## Testing

**Unit (Vitest):**

- `packages/shared/src/diagrams.test.ts` for the diagram zod schemas and slug helpers.
- `packages/diagrams/src/drawio/postMessageBridge.test.ts` for the origin check and the init/save/exit message shapes.
- `packages/diagrams/src/bpmn/stub.test.ts` for the empty BPMN XML stub validity (parsed by `bpmn-moddle`).
- `apps/web/src/lib/links.test.ts` extended with notes-and-diagrams resolution, including the note-wins tie-break.

**Integration (Vitest + real Postgres):**

- `apps/web/test/api/diagrams.test.ts` covering create, read, update, delete, optimistic concurrency conflict, and access-control denial.
- `apps/web/test/api/tree.test.ts` asserting that the tree includes both notes and diagrams, tagged by kind.
- `apps/worker/test/export.test.ts` extended to assert diagrams are written to the archive with the expected paths.

**E2E (Playwright):**

- `apps/web/playwright/diagrams-drawio.spec.ts`: create a drawio diagram, interact with the embedded iframe to add a shape, trigger save, reload, assert the shape is still there.
- `apps/web/playwright/diagrams-bpmn.spec.ts`: create a BPMN diagram, drop a task from the palette, save, reload, assert the task persists.
- `apps/web/playwright/diagrams-link.spec.ts`: create a note containing `[[My Diagram]]`, create a diagram titled "My Diagram", click the rendered link inside the note and assert navigation to the diagram page.

## Documentation and guides

- `docs/architecture.md` gains a "Diagrams" section covering the `Diagram` model, the drawio vendoring, and the bpmn-js component.
- `docs/data-model.md` documents the `Diagram` model and the extended `Link` shape.
- `docs/api.md` documents the `/api/diagrams/*` routes.
- `docs/deployment.md` notes that `apps/web/public/drawio/` is vendored and describes the refresh procedure.
- `guides/diagrams.md` is a new end-user guide covering how to create a flowchart, how to create a BPMN diagram, and how to link diagrams from notes. Written as natural prose, no emojis or em dashes.

## Open items deferred to implementation

- The exact list of drawio embed URL parameters may be trimmed during implementation once the atlas UI is tested against our save flow.
- The optimistic-concurrency shape for drawio may need a small debounce on the host PATCH to avoid a flurry of autosaves; the plan sets an initial 1 second debounce and reviews during E2E.
- The default BPMN stub may gain a labelled start event rather than a pure empty process if product feedback asks for it.
- A future follow-up can register SVG thumbnails of diagrams for use in backlinks and search results; this phase keeps the backlinks panel text-only.
