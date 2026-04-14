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

## AI integration tables

- `AiConversation` - one per `(vaultId, noteId, userId)` pairing in v1. `noteId` is nullable for future vault-wide chats. Cascades from vault delete; nulls on note delete.
- `AiMessage` - rows per turn. `role` is one of `USER`, `ASSISTANT`, `TOOL`, `SYSTEM`. `content` stores Anthropic block JSON to preserve `text`, `tool_use`, and `tool_result` structure. Token counters captured on each row from the provider's usage payload.
- `AiUsage` - one row per `(userId, day)`. Powers the daily budget check. Vault id is recorded for future per-vault reporting but is not part of the unique key.
