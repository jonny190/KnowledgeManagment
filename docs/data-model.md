# Data model

Postgres, managed by Prisma in `packages/db`. Mirrors the foundation spec.

- User, Account, Session, VerificationToken: NextAuth-standard tables plus our own `User` fields for `name` and `image`.
- Workspace, Membership, Invite: team containers, role-based memberships (OWNER, ADMIN, MEMBER), email invites with one-time tokens.
- Vault: polymorphic owner via `ownerType` (USER or WORKSPACE) and `ownerId`. One personal vault per user, one per workspace.
- Folder: hierarchical, with a denormalised `path` column such as `Projects/Acme/Notes` for fast tree rendering.
- Note: source-of-truth markdown content, belongs to a vault and optionally a folder, records `createdById` and `updatedById`.
- Attachment: metadata only, bytes live on the `/data` volume at `/data/vaults/<vaultId>/attachments/<id>-<filename>`.
- Link: sourceNoteId, targetNoteId (nullable for unresolved), targetDiagramId (nullable), targetTitle, resolved. Recomputed inside the same transaction that updates a note. Note resolution takes precedence over diagram resolution: if both a note and a diagram share the same title, the link points to the note.
- Diagram: vault-scoped diagram record. See the Diagram section below.
- ExportJob: id, vaultId, status (PENDING, RUNNING, COMPLETED, FAILED), startedAt, finishedAt, archivePath, errorMessage, requestedByUserId. Created by the web API, consumed by the worker.

Authorisation goes through a single helper `assertCanAccessVault(userId, vaultId, requiredRole)` exported from `apps/web/src/lib/auth/access.ts`. Every route and server action that touches vault-scoped data calls it.

## NoteDoc

One row per note that has ever been opened in realtime. Stores the merged Yjs document state as Bytes. Deleted when the note is deleted (via `onDelete: Cascade`). Not deleted when the room empties; the CRDT state is the source of truth for future reconnects.

| Column | Type | Notes |
| --- | --- | --- |
| noteId | String (PK) | FK to Note |
| state | Bytes | Yjs update payload |
| clock | Int | Monotonic counter, incremented on each store |
| updatedAt | DateTime | Auto |

## RealtimeGrant

One row per issued realtime JWT. Enables explicit revocation without waiting for token expiry.

| Column | Type | Notes |
| --- | --- | --- |
| jti | String (PK) | Nanoid, also claim in the JWT |
| userId | String | The issuing user |
| noteId | String | Scope of the grant |
| expiresAt | DateTime | Matches JWT exp |
| revokedAt | DateTime? | Set to block future connections |
| createdAt | DateTime | Auto |

## Diagram

One row per diagram in a vault. The `kind` column is an enum with two values: `DRAWIO` for draw.io flow diagrams and `BPMN` for business process diagrams.

| Column | Type | Notes |
| --- | --- | --- |
| id | String (PK) | cuid |
| vaultId | String | FK to Vault, cascade delete |
| folderId | String? | FK to Folder, set null on delete |
| kind | DiagramKind | DRAWIO or BPMN |
| title | String | Display name, used for wiki-link resolution |
| slug | String | URL-safe identifier, unique within the vault |
| xml | String (Text) | Full XML content of the diagram |
| contentUpdatedAt | DateTime | Updated when xml changes |
| createdAt | DateTime | Auto |
| updatedAt | DateTime | Auto-updated on every write |
| createdById | String | FK to User |
| updatedById | String | FK to User |

The `(vaultId, slug)` pair is unique. Slugs are generated from the title and deduplicated by appending a counter when needed.

The `Link.targetDiagramId` column points at a `Diagram` row when a wiki-link resolves to a diagram rather than a note. When both a note and a diagram share the same title, `targetNoteId` is set and `targetDiagramId` is left null.

## Tags

The tagging system uses two tables.

`Tag` stores one row per unique tag name per vault.

| Column | Type | Notes |
| --- | --- | --- |
| id | String (PK) | cuid |
| vaultId | String | FK to Vault, cascade delete |
| name | String | Lowercase tag name, e.g. `draft` or `project/website` |
| createdAt | DateTime | Auto |

The `(vaultId, name)` pair is unique.

`NoteTag` is the join table between notes and tags.

| Column | Type | Notes |
| --- | --- | --- |
| noteId | String (PK component) | FK to Note, cascade delete |
| tagId | String (PK component) | FK to Tag, cascade delete |
| createdAt | DateTime | Auto |

Tags are recomputed inside the same transaction that updates a note. The transaction deletes all existing `NoteTag` rows for the note, then re-parses the content with `parseTags` from `@km/shared`, upserts `Tag` rows, and inserts new `NoteTag` rows.

## Note.searchVector

The `Note` table has a `searchVector` column of type `tsvector` (Postgres only, not visible in Prisma's model directly). A `BEFORE INSERT OR UPDATE` trigger on the table calls:

```sql
NEW."searchVector" := to_tsvector('simple', coalesce(NEW.title, '') || ' ' || coalesce(NEW.content, ''));
```

An index of type `GIN` on this column supports fast full-text queries. Searches go through `websearch_to_tsquery('simple', ...)` so users can write quoted phrases and `OR` operators without learning special syntax.

## UserPlugin

Stores the list of plugin URLs a user has registered.

| Column | Type | Notes |
| --- | --- | --- |
| id | String (PK) | cuid |
| userId | String | FK to User, cascade delete |
| url | String | Absolute URL of the plugin ESM bundle |
| enabled | Boolean | Default true; false means skip on load |
| createdAt | DateTime | Auto |

The `(userId, url)` pair is unique. Adding a URL that already exists re-enables it rather than creating a duplicate.

## EmailToken

Stores hashed one-time tokens for the email verification and password reset flows. Invite tokens are not stored here; they continue to live on the `Invite` row as a hashed value.

| Column | Purpose |
| --- | --- |
| id | cuid primary key |
| userId | owner of the token; FK to User, cascade delete |
| email | destination address captured at issue time |
| kind | `VERIFY_EMAIL` or `PASSWORD_RESET` |
| tokenHash | sha256 hex of the raw token; unique across the table |
| expiresAt | absolute expiry (24 hours for VERIFY_EMAIL, 1 hour for PASSWORD_RESET) |
| consumedAt | null until the token is used; set in the same transaction that applies the effect |
| createdAt | creation timestamp |

`User.emailVerified` is the NextAuth-standard nullable DateTime field. It is set when a `VERIFY_EMAIL` token is consumed successfully. Routes that require a verified address (vault export trigger, password change) check this field and return a 403 with a machine-readable code when it is null.

`Invite.token` stores the sha256 hash of the raw invite token. The raw token is delivered in the invite email and is not stored. When a user opens the accept URL the hash is compared against the row and, on match, the membership record is created.

## Note visibility and sharing

### Note.visibility

The `Note` table has a `visibility` column of type `NoteVisibility` enum. The two possible values are `WORKSPACE` (anyone in the vault's workspace can read and edit the note) and `PRIVATE` (only the note creator and users listed in `NoteShare` can access it). Notes in personal vaults are always stored as `PRIVATE` and cannot be flipped to `WORKSPACE`.

### NoteShare

One row per user who has been granted direct access to a note. Only notes with `visibility = PRIVATE` benefit from these rows in practice, but the table is checked on every access regardless of visibility.

| Column | Type | Notes |
| --- | --- | --- |
| id | String (PK) | cuid |
| noteId | String | FK to Note, cascade delete |
| userId | String | FK to User, cascade delete |
| role | NoteShareRole | VIEW or EDIT |
| createdBy | String | userId of whoever granted access |
| createdAt | DateTime | Auto |

The `(noteId, userId)` pair is unique. PATCH on the row updates `role` in place rather than deleting and recreating.

### NoteLink

One row per public share link for a note. Multiple links per note are allowed but the UI currently surfaces only one at a time.

| Column | Type | Notes |
| --- | --- | --- |
| id | String (PK) | cuid |
| noteId | String | FK to Note, cascade delete |
| slug | String | Opaque 21-character nanoid, globally unique |
| expiresAt | DateTime? | Optional absolute expiry; null means no expiry |
| createdBy | String | userId of creator |
| createdAt | DateTime | Auto |

The unauthenticated viewer at `/public/n/[slug]` calls `GET /api/public/n/[slug]`. The route returns 404 if the link does not exist or has been deleted and 410 if `expiresAt` is in the past. A successful response carries the rendered note HTML, sanitised with `rehype-sanitize`.

## AI integration tables

- `AiConversation` - one per `(vaultId, noteId, userId)` pairing in v1. `noteId` is nullable for future vault-wide chats. Cascades from vault delete; nulls on note delete.
- `AiMessage` - rows per turn. `role` is one of `USER`, `ASSISTANT`, `TOOL`, `SYSTEM`. `content` stores Anthropic block JSON to preserve `text`, `tool_use`, and `tool_result` structure. Token counters captured on each row from the provider's usage payload.
- `AiUsage` - one row per `(userId, day)`. Powers the daily budget check. Vault id is recorded for future per-vault reporting but is not part of the unique key.
