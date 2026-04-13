# Data Model Reference

All tables are defined in `packages/db/prisma/schema.prisma`. Cuids are used for primary keys. Timestamps are UTC.

## Authentication

- `User` holds the account record. `passwordHash` is nullable so OAuth-only users do not carry a dummy hash. `email` is unique.
- `Account` stores OAuth provider links (NextAuth standard shape).
- `Session` holds active database sessions keyed by `sessionToken`.
- `VerificationToken` supports email-based flows reserved for later phases.

## Workspaces

- `Workspace` has an `ownerId` pointing at a User. Soft-deletion is not implemented in this phase.
- `Membership` links users to workspaces with a `role` enum: OWNER, ADMIN, MEMBER.
- `Invite` stores one-time invite tokens with an expiry and optional acceptance timestamp. Only the model is provided in this phase, the invite UI is added later.

## Content

- `Vault` is polymorphic via `ownerType` (USER or WORKSPACE) and `ownerId`. Every user gets a personal vault on signup.
- `Folder` is a tree inside a vault. `path` is denormalised for fast sidebar rendering. The root folder has an empty name and path.
- `Note` holds markdown content. `vaultId` plus `slug` is unique.
- `Attachment` holds file metadata. The file itself lives on disk under `DATA_DIR/vaults/<vaultId>/attachments/`.
- `Link` holds resolved and unresolved wiki-links discovered in note content.

## Background work

- `ExportJob` tracks markdown export runs. Status transitions PENDING, RUNNING, COMPLETED or FAILED. Populated by the worker in a later phase.

## Cascade behaviour

Deleting a User cascades to Accounts, Sessions, Memberships. Deleting a Workspace cascades to Memberships and Invites. Deleting a Vault cascades to Folders, Notes, Attachments, and ExportJobs. Deleting a Folder cascades to descendant Folders via the self-relation and sets dependent Note and Attachment `folderId` to null.
