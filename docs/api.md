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

## Search

### GET /api/search?vaultId=...&q=...&limit=...

Full-text search across note titles and content in a vault. The caller must be a member of the vault.

Query parameters:

- `vaultId` (required) - the vault to search.
- `q` (required) - the query string. Supports quoted phrases, `OR`, and `-term` exclusions via `websearch_to_tsquery`.
- `limit` (optional, default 50, max 100) - maximum number of results.

Response:

```json
{
  "results": [
    {
      "id": "...",
      "title": "My note",
      "snippet": "...highlighted <mark>match</mark> context...",
      "rank": 0.0759,
      "updatedAt": "2026-04-14T10:00:00Z"
    }
  ]
}
```

Queries shorter than two characters return an empty result without hitting the database.

## Tags

### GET /api/vaults/:id/tags

Returns all tags used across notes in the vault, ordered by note count descending then name ascending.

Response:

```json
{
  "tags": [
    { "name": "draft", "count": 5 },
    { "name": "project/website", "count": 2 }
  ]
}
```

## Graph

### GET /api/vaults/:id/graph

Returns the complete knowledge graph for a vault as nodes and directed edges. Each node is a note and each edge represents a wiki-link from one note to another.

Response:

```json
{
  "nodes": [
    { "id": "...", "title": "Alpha", "slug": "alpha" }
  ],
  "edges": [
    { "source": "...", "target": "...", "targetTitle": "Beta" }
  ]
}
```

Unresolved links (where the target note does not exist) are omitted from edges.

## Plugins

### GET /api/plugins

Returns all plugin records for the authenticated user.

Response: `{ "plugins": [{ "id": "...", "url": "...", "enabled": true, "createdAt": "..." }] }`

### POST /api/plugins

Body: `{ "url": "..." }`. Adds a plugin URL for the current user. If the URL already exists it is re-enabled. Returns 201 with the created or updated plugin record.

### PATCH /api/plugins/:id

Body: `{ "enabled": true | false }`. Toggles the plugin on or off without removing it. Returns 200 with the updated record.

### DELETE /api/plugins/:id

Removes the plugin record. Returns 204.

## Theme

### PATCH /api/me/theme

Body: `{ "themePreference": "light" | "dark" | "system" }`. Stores the user's preferred colour scheme. Returns 204. The application reads this preference server-side to apply the correct CSS class before the first paint.

## AI routes

### POST /api/ai/conversations

Body: `{ vaultId, noteId }`. Returns the existing conversation for `(vault, note, user)` or creates a new one. Includes `messages` ordered ascending.

### POST /api/ai/chat

Body: `{ conversationId, message }`. Server-Sent Events response. Event types: `ready`, `text`, `tool_use`, `tool_result`, `usage`, `done`, `error`. Returns 429 with `{ code: "budget_exceeded", reason }` if the daily budget is reached before the call.

### POST /api/ai/command

Body: `{ conversationId, command, selection, language? }`. Same SSE event grammar as `/api/ai/chat`. The `command` is one of `summarize`, `expand`, `rewrite`, `translate`. `language` is required for `translate`.

## Note sharing

### GET /api/notes/:id/shares

Returns the list of per-user shares and active public links for a note. The caller must have at least VIEW access to the note.

Response:

```json
{
  "shares": [
    {
      "id": "...",
      "userId": "...",
      "role": "VIEW" | "EDIT",
      "user": { "email": "...", "name": "..." }
    }
  ],
  "links": [
    {
      "id": "...",
      "slug": "...",
      "expiresAt": null,
      "createdAt": "..."
    }
  ]
}
```

### POST /api/notes/:id/shares

Body: `{ "email": "...", "role": "VIEW" | "EDIT" }`. Grants access to the user with the given email address. Returns 201 with the created share row. Returns 404 with `{ "reason": "user_not_found" }` if no account exists for that email. Returns 404 with `{ "reason": "note_not_found" }` if the caller cannot see the note. The caller must have OWNER or EDIT access to the note.

### PATCH /api/notes/:id/shares/:userId

Body: `{ "role": "VIEW" | "EDIT" }`. Updates the role of an existing share. Returns 200 with the updated share row. Returns 404 if the share does not exist. The caller must have OWNER access.

### DELETE /api/notes/:id/shares/:userId

Removes the share. Returns 204. The caller must have OWNER access.

### POST /api/notes/:id/visibility

Body: `{ "visibility": "WORKSPACE" | "PRIVATE" }`. Flips the note visibility. Returns 200 with the updated note. Returns 400 if the note is in a personal vault (personal vault notes are always PRIVATE). The caller must have OWNER access.

### POST /api/notes/:id/links

Body: `{}`. Creates a new public share link. Returns 201 with `{ "link": { "id": "...", "slug": "...", "expiresAt": null, "createdAt": "..." } }`. The caller must have OWNER access.

### DELETE /api/notes/:id/links/:linkId

Deletes the public link. Returns 204. The caller must have OWNER access.

## Public viewer

### GET /api/public/n/:slug

Unauthenticated endpoint. Returns the rendered note content for the given public link slug.

Response on success:

```json
{
  "title": "My note",
  "html": "<p>Sanitised note HTML</p>",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Status codes:

- 200: link is valid and note is readable.
- 404: link does not exist or has been deleted.
- 410: link exists but `expiresAt` is in the past.

## Internal endpoints

### POST /internal/ydoc/apply (apps/realtime)

This endpoint is internal and is never routed publicly. Cloudflare must only
forward `/yjs` to the realtime container.

Headers:

- `Content-Type: application/json`
- `X-KM-Admin-Signature: HMAC-SHA256(REALTIME_ADMIN_SECRET, rawBody)` as hex.

Body:

```json
{ "noteId": "...", "op": "append" | "replace", "text": "...", "origin": "ai" }
```

Responses:

- 200 `{ "applied": true, "revision": <int> }`
- 400 bad body
- 401 signature missing or mismatch
- 405 method not POST

The mutation runs under the per-note mutex that also guards snapshots, so
concurrent admin POSTs for the same note serialise deterministically.
