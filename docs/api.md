# API reference

All routes are served by the Next.js web app and require an authenticated session unless noted otherwise. Auth is handled by NextAuth; include the session cookie or a valid Bearer token when calling from outside the browser.

## AI routes

### POST /api/ai/conversations

Body: `{ vaultId, noteId }`. Returns the existing conversation for `(vault, note, user)` or creates a new one. Includes `messages` ordered ascending.

### POST /api/ai/chat

Body: `{ conversationId, message }`. Server-Sent Events response. Event types: `ready`, `text`, `tool_use`, `tool_result`, `usage`, `done`, `error`. Returns 429 with `{ code: "budget_exceeded", reason }` if the daily budget is reached before the call.

### POST /api/ai/command

Body: `{ conversationId, command, selection, language? }`. Same SSE event grammar as `/api/ai/chat`. The `command` is one of `summarize`, `expand`, `rewrite`, `translate`. `language` is required for `translate`.
