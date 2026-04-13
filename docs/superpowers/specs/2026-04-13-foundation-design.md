# Foundation MVP — Web-based Knowledge Management Platform

**Date:** 2026-04-13
**Status:** Approved design, ready for implementation planning
**Sub-project:** 1 of 5 (Foundation)

## Context

We are building a web-based, multi-user knowledge management platform inspired by Obsidian. All data is held on the server. Future phases will add realtime collaboration, AI integration, drawio and bpmn-js diagram editors, and polish features (graph view, search, plugins).

This document specifies the **Foundation** sub-project only. Subsequent phases each get their own spec.

The reference repository at `/home/jonny/obsidian-releases/` is the community plugin index, not Obsidian source code (Obsidian is closed source). We draw on Obsidian's concepts (markdown vault, wiki-links, backlinks) rather than porting code.

## Goals

Deliver a web app supporting many users (each with their own account and personal vault) where two users editing the *same* note concurrently is not yet a supported scenario — that is the realtime phase. Within that constraint, signed-in users can:

- Create and edit markdown notes in a personal vault
- Form workspaces, invite other users, and share a workspace vault
- Use `[[Wiki Links]]` between notes with autocomplete
- See backlinks for any note
- Organise notes into folders via a file tree
- Upload image and file attachments
- Trigger and download a markdown export of any vault they can access (vaults are also exported on a nightly schedule)

Out of scope for this phase: realtime co-editing, AI features, diagram editors, full-text search, tags, dark mode, per-note ACLs, plugins, mobile apps.

## Roadmap (context for sequencing)

The agreed build order across all sub-projects:

1. **Foundation** (this spec) — server, auth, vault, single-user editor
2. **Realtime collaboration** — Yjs CRDTs, presence, cursors
3. **AI integration** — chat panel and inline commands via API
4. **Diagrams** — drawio and bpmn-js as separate file types
5. **Polish** — graph view, full-text search, tags, plugin system

The Foundation is designed so each later phase slots in as a new package without rewriting core.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Database | PostgreSQL via Prisma |
| Auth | NextAuth/Auth.js (Credentials + Google + GitHub) |
| Editor | CodeMirror 6 |
| Repo | pnpm workspaces + Turborepo |
| Background jobs | pg-boss (Postgres-backed queue, no Redis in v1) |
| Deployment | Coolify, Docker, Cloudflare proxy for HTTPS |
| Testing | Vitest (unit + integration), Playwright (E2E) |

## Repository layout

```
KnowledgeManagment/
├── apps/
│   ├── web/              Next.js app (UI + API routes + server actions)
│   └── worker/           Node service for background jobs (markdown export)
├── packages/
│   ├── db/               Prisma schema + client + migrations
│   ├── shared/           Shared TS types, zod schemas, link-parsing utils
│   └── editor/           CodeMirror 6 setup, wiki-link extension, themes
├── infra/
│   ├── docker/           Dockerfiles for web + worker
│   └── coolify/          Coolify deployment notes/config
├── docs/                 Project docs
├── guides/               End-user guides
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

Future phases add `packages/collab`, `packages/ai`, `packages/diagrams` without modifying `apps/web` core.

## Data model

Postgres schema, managed by Prisma in `packages/db`.

```
User              id, email, passwordHash?, name, image, createdAt
Account           NextAuth standard (OAuth provider links)
Session           NextAuth standard
VerificationToken NextAuth standard

Workspace         id, name, slug, ownerId, createdAt
Membership        id, workspaceId, userId, role(OWNER|ADMIN|MEMBER)
Invite            id, workspaceId, email, token, role, expiresAt, acceptedAt?

Vault             id, ownerType(USER|WORKSPACE), ownerId, name, createdAt
                  -- each User auto-gets one personal Vault on signup
                  -- each Workspace gets one Vault on creation

Folder            id, vaultId, parentId?, name, path (denormalized)
Note              id, vaultId, folderId?, title, slug,
                  content (text),
                  contentUpdatedAt, createdAt, updatedAt,
                  createdById, updatedById
Attachment        id, vaultId, folderId?, filename, mimeType, size,
                  storagePath, uploadedById, createdAt

Link              id, sourceNoteId, targetNoteId?, targetTitle (raw),
                  resolved (bool)
                  -- recomputed on every note save; powers backlinks panel

ExportJob         id, vaultId, status, startedAt, finishedAt?, archivePath?
```

Design notes:

- `Vault` is polymorphic via `ownerType` and `ownerId` so personal and workspace vaults share all downstream tables.
- `Note.content` is the source of truth. Markdown export materialises notes as `.md` files on a schedule.
- `Link` rows are rebuilt inside the same transaction that updates a note so backlink queries are O(rows) without scanning content.
- `Folder.path` is denormalised (e.g. `Projects/Acme/Notes`) for fast tree rendering. Application code keeps it in sync on rename/move.
- Attachments live on disk under a vault-scoped path; the database holds metadata only.

## Auth and access control

**Providers:** NextAuth/Auth.js with three providers — Credentials (email + bcrypt), Google OAuth, GitHub OAuth. Sessions stored in Postgres via the NextAuth Prisma adapter (no JWT — DB sessions allow easy revocation).

**Signup flow:** a single transaction creates the `User`, a personal `Vault` (`ownerType=USER`), and a root `Folder`. No workspace is created by default.

**Workspaces:**

- Any signed-in user can create a workspace and becomes its `OWNER`.
- Owners and admins can invite by email. The system generates an `Invite` with a one-time token; the recipient accepts (signing up first if needed).
- Roles: `OWNER` (one per workspace, can delete), `ADMIN` (manage members), `MEMBER` (read/write notes).
- v1 has no per-note ACLs — workspace membership grants full read/write on the workspace vault. Per-note sharing is deferred.

**Authorization layer:** a single helper `assertCanAccessVault(userId, vaultId, requiredRole)` is called at the top of every server action and API route that touches vault data. It returns the resolved membership or throws. All authorisation logic lives in this helper rather than scattered through handlers.

**Personal vault privacy:** personal vaults are only accessible to their owner. No sharing of personal vaults in v1.

## Editor and note features

The editor lives in `packages/editor` and is consumed by `apps/web`.

**Editor stack:**

- CodeMirror 6 with the official markdown language package
- Custom wiki-link extension: tokenises `[[Note Title]]` and `[[Note Title|alias]]`, decorates them as clickable spans. Click navigates to the target note, or opens a "create note" dialog if unresolved.
- Wiki-link autocomplete: triggered on `[[`, queries `/api/notes/search?q=&vaultId=` with debounced prefix search over note titles in the current vault.
- Live preview decorations for headings, bold, italic, code blocks. The buffer remains markdown source — no WYSIWYG mode-switching.
- Extension structure leaves a clear seam for the Yjs binding in phase 2.

**Save model:**

- Debounced autosave: 1.5s after last keystroke, or immediately on blur or navigation.
- `PATCH /api/notes/:id` sends full content. Server diffs links and updates the `Link` table in the same transaction as the note update.
- Optimistic UI; toast surfaced on save failure.

**Backlinks panel** (right sidebar): queries `Link` rows where `targetNoteId = currentNote.id`. Each entry shows the source note title and a snippet of surrounding text computed server-side from the source note's content.

**File tree** (left sidebar):

- Lists folders and notes for the active vault.
- Drag to move; right-click context menu for rename, delete, new note, new folder.
- Switcher at the top to choose between the user's personal vault and any workspace vaults they belong to.

**Attachments:**

- Drag-drop into the editor uploads to `POST /api/attachments`. The response includes a markdown image link (`![](/api/attachments/<id>)`) which is inserted at the cursor.
- Files are stored on disk under `${DATA_DIR}/vaults/<vaultId>/attachments/<id>-<filename>`.
- Served via `GET /api/attachments/:id`, which re-checks vault access before streaming.

## API surface

Next.js route handlers and server actions in `apps/web`.

```
auth/*                          NextAuth handlers

GET    /api/vaults              list vaults user can access
POST   /api/workspaces          create workspace
POST   /api/workspaces/:id/invites
POST   /api/invites/:token/accept

GET    /api/vaults/:id/tree     folders + notes for sidebar
POST   /api/folders             create
PATCH  /api/folders/:id         rename / move
DELETE /api/folders/:id

GET    /api/notes/:id
POST   /api/notes               create
PATCH  /api/notes/:id           update content (recomputes links)
DELETE /api/notes/:id
GET    /api/notes/search?q=&vaultId=
GET    /api/notes/:id/backlinks

POST   /api/attachments         multipart upload
GET    /api/attachments/:id     authenticated stream

POST   /api/exports/:vaultId    trigger export (queues job)
GET    /api/exports/:jobId      status + download URL
```

Server actions are used for form-driven mutations (workspace creation, invite acceptance). Route handlers are used for everything called from the editor and sidebar.

## Markdown export (worker)

`apps/worker` runs a `pg-boss` queue consumer.

- **Two job types:** on-demand (user clicks "Export") and scheduled (nightly per vault).
- **What it does:** reads all notes and folders for the vault, writes a tree of `.md` files mirroring folder paths into a working directory, zips the directory, stores the archive at `${DATA_DIR}/exports/<jobId>.zip`, sets `ExportJob.archivePath` and `status = COMPLETED`.
- **Wiki-link handling:** wiki-links are written verbatim, so the export is re-importable by Obsidian or any markdown tool.
- **Why pg-boss:** avoids adding Redis as a dependency for v1. If queue load grows, swap to BullMQ in a later phase.

## Deployment

Coolify-managed Docker deployment.

- Two services from one repo: `web` (Next.js production build) and `worker` (Node).
- One Postgres service.
- A shared Docker volume mounted at `/data` in both services for `attachments/` and `exports/`.
- Per the user's global Coolify rule, services are exposed over **HTTP**; Cloudflare proxy provides HTTPS.
- Env vars: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, OAuth client IDs and secrets for Google and GitHub, `DATA_DIR=/data`.
- `infra/docker/` contains a Dockerfile per app; `infra/coolify/` contains deployment notes and any Coolify-specific config.

## Testing strategy

- **Unit (Vitest):** `packages/shared` (link parser, slug utils) and `packages/editor` (wiki-link extension state).
- **Integration (Vitest + real Postgres):** API routes, the `assertCanAccessVault` helper, and link recomputation. No DB mocking — tests hit a real Postgres test database.
- **E2E (Playwright):** the golden paths — signup, create vault, write note containing `[[link]]`, see backlink — plus the invite-and-collaborate-on-workspace flow.
- **CI:** GitHub Actions running lint, typecheck, unit, and integration tests on every PR; E2E on `main`.

## Documentation and guides

Per the user's global rules:

- `docs/` — architecture overview, data model reference, API reference, deployment runbook. Kept in sync with code changes.
- `guides/` — end-user guides: getting started, creating vaults, inviting members, exporting. Kept in sync with feature changes. Written naturally, no emojis or special characters.

## Open items deferred to implementation

These are intentionally not specified here and will be settled during implementation planning:

- Exact Prisma schema details (indexes, cascade rules, enum encoding)
- Choice of UI component library (likely shadcn/ui + Tailwind, to confirm)
- Exact CodeMirror theme tokens
- Rate-limit policy for auth endpoints
