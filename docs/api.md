# API reference

All routes are served by the Next.js web app and require an authenticated session unless noted otherwise. Auth is handled by NextAuth; include the session cookie or a valid Bearer token when calling from outside the browser.

## Vault tree

### GET /api/vaults/:id/tree

Returns the folder tree and a flat list of all items in the vault.

Response:

```json
{
  "root": { "id": "...", "name": "", "path": "", "children": [...], "notes": [...] },
  "items": [
    { "kind": "note", "id": "...", "title": "...", "folderId": "...", "updatedAt": "..." },
    { "kind": "drawio", "id": "...", "title": "...", "folderId": "...", "updatedAt": "..." },
    { "kind": "bpmn", "id": "...", "title": "...", "folderId": "...", "updatedAt": "..." }
  ],
  "notes": [{ "id": "...", "title": "...", "slug": "...", "folderId": "..." }]
}
```

The `notes` key is preserved for backward compatibility. New consumers should read from `items`, which includes diagrams.

## Diagrams

### POST /api/diagrams

Body: `{ vaultId, kind, title, folderId? }`. `kind` must be `DRAWIO` or `BPMN`. Creates a diagram with blank starter XML. Returns 201 with the created diagram object.

### GET /api/diagrams/:id

Returns the full diagram object including the `xml` field.

### PATCH /api/diagrams/:id

Body: `{ xml?, title?, folderId?, expectedUpdatedAt? }`. Updates the diagram. If `expectedUpdatedAt` is provided and does not match the stored `updatedAt`, returns 409 to indicate a concurrency conflict. The client should reload and retry.

### DELETE /api/diagrams/:id

Deletes the diagram. Returns 204.

### GET /api/diagrams/:id/backlinks

Returns all `Link` rows that point at this diagram as their target, each including the source note's id, title, and slug.

## Wiki-link resolution

### GET /api/links/resolve?vaultId=...&title=...

Resolves a wiki-link title within a vault. Returns a target object:

- `{ kind: "note", id: "..." }` when a note with that title exists.
- `{ kind: "diagram", id: "..." }` when no note but a diagram with that title exists.
- `{ kind: null, id: null }` when neither exists.

Notes take precedence when both exist.

## AI routes

### POST /api/ai/conversations

Body: `{ vaultId, noteId }`. Returns the existing conversation for `(vault, note, user)` or creates a new one. Includes `messages` ordered ascending.

### POST /api/ai/chat

Body: `{ conversationId, message }`. Server-Sent Events response. Event types: `ready`, `text`, `tool_use`, `tool_result`, `usage`, `done`, `error`. Returns 429 with `{ code: "budget_exceeded", reason }` if the daily budget is reached before the call.

### POST /api/ai/command

Body: `{ conversationId, command, selection, language? }`. Same SSE event grammar as `/api/ai/chat`. The `command` is one of `summarize`, `expand`, `rewrite`, `translate`. `language` is required for `translate`.
