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
