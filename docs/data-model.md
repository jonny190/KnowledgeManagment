# Data model

Postgres, managed by Prisma in `packages/db`. Mirrors the foundation spec.

- User, Account, Session, VerificationToken: NextAuth-standard tables plus our own `User` fields for `name` and `image`.
- Workspace, Membership, Invite: team containers, role-based memberships (OWNER, ADMIN, MEMBER), email invites with one-time tokens.
- Vault: polymorphic owner via `ownerType` (USER or WORKSPACE) and `ownerId`. One personal vault per user, one per workspace.
- Folder: hierarchical, with a denormalised `path` column such as `Projects/Acme/Notes` for fast tree rendering.
- Note: source-of-truth markdown content, belongs to a vault and optionally a folder, records `createdById` and `updatedById`.
- Attachment: metadata only, bytes live on the `/data` volume at `/data/vaults/<vaultId>/attachments/<id>-<filename>`.
- Link: sourceNoteId, targetNoteId (nullable for unresolved), targetTitle, resolved. Recomputed inside the same transaction that updates a note.
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

## AI integration tables

- `AiConversation` - one per `(vaultId, noteId, userId)` pairing in v1. `noteId` is nullable for future vault-wide chats. Cascades from vault delete; nulls on note delete.
- `AiMessage` - rows per turn. `role` is one of `USER`, `ASSISTANT`, `TOOL`, `SYSTEM`. `content` stores Anthropic block JSON to preserve `text`, `tool_use`, and `tool_result` structure. Token counters captured on each row from the provider's usage payload.
- `AiUsage` - one row per `(userId, day)`. Powers the daily budget check. Vault id is recorded for future per-vault reporting but is not part of the unique key.
