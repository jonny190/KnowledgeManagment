# v0.2-B Per-Note ACLs

**Date:** 2026-04-16
**Status:** Approved design, ready for implementation planning
**Builds on:** v0.2.1 (Foundation + Phase 2-5 + email flows + AI write tools)

## Context

v0.1 treats a note's access as inherited from the containing vault. Every member of a workspace can read and edit every note in that workspace's vault. Personal-vault notes are single-owner. There is no way to share a single note with a specific person, and no way to publish a note for external viewers. v0.2-B adds both per-user sharing with View/Edit roles and revocable public read-only links, without forcing a new mental model on existing users.

## Goals

- A note owner can share a single note with another registered user and pick VIEW or EDIT.
- A note owner can mark a note PRIVATE to restrict it from the default workspace-wide access.
- A note owner can generate a public read-only link with an optional expiry, shown to unauthenticated visitors as a static page.
- Delete stays with the note owner. Shared EDIT users cannot delete.
- Existing workspace usage is unchanged until a user opts in (no migration pain).

Out of scope:

- Comments or a Comment role.
- Folder-level share inheritance.
- Password-protected public links.
- Public write links.
- Per-folder visibility.
- Read-only in-editor mode for VIEW users (they see the public-style static render instead).

## Stack additions

| Concern | Choice |
|---|---|
| Per-user sharing | new `NoteShare` table, roles VIEW + EDIT |
| Visibility toggle | `Note.visibility` enum column, WORKSPACE default, PRIVATE opt-in |
| Public read-only links | new `NoteLink` table, opaque nanoid slug, optional `expiresAt` |
| Primary authz | new `assertCanAccessNote(userId, noteId, required)` helper |
| Migration | one Prisma migration `v02b_note_acls` |

## System shape

```
Any note-scoped route / tool ──► assertCanAccessNote(userId, noteId, required)
                                          │
          Personal-vault owner? ──────────┤ return OWNER
          Note creator?         ──────────┤ return OWNER
          NoteShare row?        ──────────┤ return VIEW or EDIT
          Workspace visibility + member?──┤ return EDIT (OWNER/ADMIN workspace -> OWNER)
          else                  ──────────► throw AuthzError
```

Folder, diagram, and vault-listing routes keep using `assertCanAccessVault` because they operate on vault-wide structures rather than individual notes. The realtime WS `onAuthenticate` hook moves to `assertCanAccessNote` with `EDIT` required. The `/internal/ydoc/apply` HMAC transport does not change; only the web-side caller's authz tightens.

Public links live in their own flow: an unauthenticated `/api/public/n/[slug]` endpoint and a `/public/n/[slug]` page. The public viewer renders sanitised markdown and never loads the CRDT editor.

## Data model

```prisma
enum NoteVisibility {
  WORKSPACE
  PRIVATE
}

enum NoteShareRole {
  VIEW
  EDIT
}

model Note {
  // ...existing fields...
  visibility   NoteVisibility @default(WORKSPACE)
  shares       NoteShare[]
  publicLinks  NoteLink[]
}

model NoteShare {
  id        String        @id @default(cuid())
  noteId    String
  userId    String
  role      NoteShareRole
  createdAt DateTime      @default(now())
  createdBy String

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([noteId, userId])
  @@index([userId])
}

model NoteLink {
  id         String    @id @default(cuid())
  noteId     String
  slug       String    @unique
  expiresAt  DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  createdBy  String

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId])
}
```

Design notes:

- `NoteShare.@@unique([noteId, userId])` means a user can have at most one role per note. Regrants update the row.
- `NoteLink.slug` is a `nanoid(21)` distinct from any guessable note id.
- Personal-vault notes force `visibility = PRIVATE` on creation (the create handlers apply this automatically); the column still exists so queries are uniform.
- The migration's new column defaults to WORKSPACE so existing workspace notes behave identically after migration.

## `assertCanAccessNote` helper

File: `apps/web/src/lib/note-authz.ts`

```ts
export type RequiredNoteRole = "VIEW" | "EDIT" | "OWNER";

export interface NoteAccess {
  note: {
    id: string;
    vaultId: string;
    visibility: "WORKSPACE" | "PRIVATE";
    createdById: string;
  };
  grantedBy:
    | { kind: "personal_owner" }
    | { kind: "note_owner" }
    | { kind: "workspace"; role: "OWNER" | "ADMIN" | "MEMBER" }
    | { kind: "share"; role: "VIEW" | "EDIT" };
  effectiveRole: "VIEW" | "EDIT" | "OWNER";
}

export async function assertCanAccessNote(
  userId: string,
  noteId: string,
  required: RequiredNoteRole,
): Promise<NoteAccess>;
```

**Resolution order** (first match wins):

1. Note creator: `note.createdById === userId` -> `OWNER`.
2. Personal-vault owner: vault has `ownerType=USER && ownerId=userId` -> `OWNER`.
3. Explicit share: a `NoteShare` row for `(noteId, userId)` -> VIEW or EDIT.
4. Workspace-visibility fallback: vault `ownerType=WORKSPACE`, `note.visibility=WORKSPACE`, user has a `Membership` in that workspace. Workspace `OWNER`/`ADMIN` -> `OWNER`, `MEMBER` -> `EDIT`.
5. Else: throw `AuthzError("Forbidden", 403)`.

Role comparison: `OWNER > EDIT > VIEW`. `required=VIEW` accepts any level; `required=EDIT` needs EDIT or OWNER; `required=OWNER` needs OWNER.

## Call-site migration

Switch from `assertCanAccessVault` to `assertCanAccessNote`:

- `GET /api/notes/[id]` -> `VIEW`.
- `PATCH /api/notes/[id]` -> `EDIT`.
- `DELETE /api/notes/[id]` -> `OWNER`.
- `GET /api/notes/[id]/backlinks` -> `VIEW`.
- `GET /api/attachments/[id]` -> resolve the attachment's note (if any) and require `VIEW`, else fall back to existing vault check.
- `@km/ai` tools: `readNote` -> `VIEW`; `updateNote` -> `EDIT`.
- Realtime `onAuthenticate` hook -> `EDIT`.

Stay on `assertCanAccessVault`:

- `GET /api/vaults/[id]/tree`, folder CRUD, diagram CRUD, search (vault-scoped), tag endpoints, export trigger.
- The rationale: these return many items at once and folder/diagram ACLs are out of scope for v0.2-B. A user must still be a workspace member to see a workspace vault's tree; individual PRIVATE notes are filtered from the tree response.
- `GET /api/vaults/[id]/tree` gets one additional filter: for workspace vaults, include a note in the response only if `assertCanAccessNote` would grant `VIEW`. A simple `WHERE visibility=WORKSPACE OR createdById=me OR id IN (SELECT noteId FROM NoteShare WHERE userId=me)` covers the common case without an N+1.

## API routes

```
GET    /api/notes/[id]/shares           list shares + links (OWNER)
POST   /api/notes/[id]/shares           { email, role }                 (OWNER)
PATCH  /api/notes/[id]/shares/[userId]  { role }                        (OWNER)
DELETE /api/notes/[id]/shares/[userId]                                  (OWNER)

POST   /api/notes/[id]/visibility       { visibility: "WORKSPACE" | "PRIVATE" }  (OWNER)

POST   /api/notes/[id]/links            { expiresAt?: ISO string }      (OWNER)
DELETE /api/notes/[id]/links/[linkId]                                   (OWNER)

GET    /api/public/n/[slug]             unauthenticated
```

Behaviour notes:

- `POST /shares` with an email that does not resolve to an existing user returns 404 with `{ reason: "user_not_found" }`. The UI explains and offers an invite flow if the user is in a workspace.
- `POST /visibility` on a personal-vault note returns 400 with `{ reason: "personal_vault_is_always_private" }`.
- `GET /api/public/n/[slug]` returns 200 with `{ note: { title, html, renderedAt } }`, 404 if not found or revoked, 410 if expired.

## UI

- Note page header gains a "Share" button that opens `NoteShareDialog`.
- `NoteShareDialog` shows:
  - Current list of shares with role dropdown (View/Edit) and remove button.
  - An email input + role dropdown for adding a share.
  - Visibility toggle (WORKSPACE/PRIVATE) - hidden for personal-vault notes.
  - Public link section: "Create public link" button or existing link with copy + revoke + expiry picker.
- Note header shows a small "Shared" badge when `shares.length > 0` or an active public link exists.
- Public viewer at `/public/n/[slug]` is a minimal server-rendered page with the note title and rendered markdown. No app chrome. Open Graph meta tags (`og:title`, `og:description` from the first 160 chars of text).

## Realtime

Hocuspocus's `onAuthenticate` currently calls `assertCanAccessVault`. Switch to `assertCanAccessNote` requiring `EDIT`. VIEW-only users attempting to connect get an `authenticationFailed` event in the browser; the note page handles this by falling back to the public-style render (or a friendly "view-only access" static page). Actual read-only CM6 is out of scope; VIEW users get a simpler rendered page.

## Testing

- **Unit (Vitest):** `assertCanAccessNote` with each resolution branch, including boundary cases (PRIVATE workspace note + non-shared member should reject; creator of a PRIVATE note always accesses).
- **Integration (real Postgres):**
  - Each new API route: happy path, forbidden, not-found.
  - Switch-over tests on existing note routes: workspace member still has access to WORKSPACE notes (no regression), gets 403 on PRIVATE notes they're not shared to.
  - Tree endpoint filters out PRIVATE notes for unrelated members.
  - Public link endpoint: valid, revoked, expired.
- **Playwright E2E:** Alice shares note with Bob; Bob reads it. Alice flips PRIVATE; Carol (another workspace member) loses access. Alice creates public link; unauthenticated browser opens it. Alice revokes; same URL returns 404.

## Migration and rollout

- One Prisma migration `v02b_note_acls` adds the enum, the two tables, and the `visibility` column.
- No data backfill needed: default visibility WORKSPACE preserves existing behaviour exactly.
- Deploy order: ship the migration and server code together; client-side `NoteShareDialog` uses capability detection on the new endpoints so an old client talking to a new server still works (it just doesn't show the Share button).

## Documentation

- `docs/architecture.md` - new subsection "Note ACLs" summarising the resolution order, the realtime implication, and the public link flow.
- `docs/data-model.md` - document `Note.visibility`, `NoteShare`, `NoteLink`.
- `docs/api.md` - the new routes and public-link shape.
- `guides/sharing.md` - end-user guide: share a note, flip to PRIVATE, create a public link, revoke.

## Open items deferred to implementation

- Exact Open Graph description extraction (naive first-160-chars vs a markdown-aware strip).
- Whether to rate-limit public link creation per user per hour.
- Read-only CM6 as a follow-up phase once v0.2-B is live.
