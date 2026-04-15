# v0.2-A Email Flows

**Date:** 2026-04-15
**Status:** Approved design, ready for implementation planning
**Builds on:** v0.1.0 (Foundation + Phase 2-5 shipped)

## Context

v0.1.0 ships with three places that want to send email but currently only log to the console: workspace invites (Phase 1 Plan B), AI chat (none yet), and exports (none yet). Signup has no email verification, there is no password reset, and invites cannot actually be delivered to anyone outside the dev console. v0.2-A adds real outbound email for the three flows that materially change product usability and risk.

## Goals

- Workspace invite email is delivered to the invitee's inbox.
- New signups receive a verification email; the UI shows their verified state but does not block most actions ("b-soft").
- Users can reset a forgotten password via an emailed link.
- A console provider is always selectable via env so local dev and CI never depend on external APIs.
- Graph API is used for real delivery, via client-credentials (no user interaction).

Out of scope for v0.2-A:

- Email change confirmation.
- Export-ready notifications.
- Hard verification gate on every action.
- User-facing email preferences or notification settings.
- Any provider other than Microsoft Graph or console.

## Stack additions

| Concern | Choice |
|---|---|
| Package | new `packages/email` |
| Provider (prod) | Microsoft Graph, client credentials, `Mail.Send` application permission |
| Provider (dev/CI) | `console`, logs payload and returns a stub id |
| Selection | `EMAIL_PROVIDER=console\|graph` env var, default `console` |
| Dispatcher | `pg-boss` job named `send-email`, handled in `apps/worker` |
| Retries | pg-boss default retries with backoff |
| Rate limit | per email + kind, max 3 per 10 minutes, enforced in worker |

## System shape

A new `packages/email` workspace package owns the `sendEmail` contract, typed templates, and provider implementations. `apps/web` never calls it directly; instead every email-triggering route enqueues a `send-email` job into the existing `pg-boss` queue and returns immediately. `apps/worker` registers a `send-email` handler that calls `@km/email`. The same pg-boss already drives vault exports, so no new infra.

```
Web action ──► insert EmailToken ──► pg-boss enqueue send-email ──► 200 to caller
                                                │
Worker ◄──────────── dequeue send-email ◄───────┘
   │
   └──► @km/email.sendEmail({ to, kind, data })
            │
            ├──► console provider (logs + returns stub id)
            └──► graph provider (POST /users/{mailbox}/sendMail)
```

## Data model

One new table plus reuse of the existing `User.emailVerified` column that NextAuth already provides.

```prisma
enum EmailTokenKind {
  VERIFY_EMAIL
  PASSWORD_RESET
}

model EmailToken {
  id         String         @id @default(cuid())
  userId     String
  email      String
  kind       EmailTokenKind
  tokenHash  String         @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime       @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([email, kind])
  @@index([expiresAt])
}
```

Design notes:

- The `INVITE` kind is intentionally not stored in `EmailToken`. Workspace invites already have their own `Invite` row with `tokenHash`. The send-email job for an invite references the invite id and the provider reads the invite details at send time.
- `User.emailVerified` is the NextAuth-standard nullable DateTime. When null, the banner shows and gated actions reject.
- Token hashes use `sha256(rawToken)` so a DB leak does not expose usable links.

## Flows

### Signup -> verify email (b-soft)

1. `signupWithCredentials` runs its existing transaction (User + Vault + root Folder).
2. After commit, the signup route enqueues `send-email` with `{ kind: "VERIFY_EMAIL", userId }`.
3. Worker generates a raw token + hash, inserts `EmailToken(userId, email, kind=VERIFY_EMAIL, tokenHash, expiresAt = now + 24h)`, renders the verify template, dispatches.
4. User clicks `${APP_URL}/verify-email?token=<raw>`. The server component calls `consumeEmailToken(raw, "VERIFY_EMAIL")` inside a transaction that: sets `consumedAt = now()`, checks not already consumed, checks not expired, and updates `User.emailVerified = now()`. Redirects to `/?verified=1`.
5. Until verified:
   - The `(app)` layout renders a dismissable banner with a "resend verification email" button.
   - `POST /api/me/password` (future) and `POST /api/exports/:vaultId` reject with 403 and `{ reason: "verify_email_required" }`.
   - All other actions work unchanged.

### Password reset

1. Public `/forgot` page posts to `POST /api/auth/forgot` with `{ email }`. The handler always returns 200 to prevent user enumeration. If the user exists, it enqueues `send-email` with `{ kind: "PASSWORD_RESET", userId }`.
2. Worker generates token, inserts `EmailToken(kind=PASSWORD_RESET, expiresAt = now + 1h)`, sends `${APP_URL}/reset?token=<raw>`.
3. `/reset?token=` client page asks for a new password. Submit posts to `POST /api/auth/reset` with `{ token, password }`. Handler consumes the token, updates `passwordHash`, and (future-proofing) calls a `signOutAllSessions(userId)` helper that is a no-op today (JWT) but becomes meaningful if we move to DB sessions later. Redirects to `/login?reset=ok`.

### Workspace invite email

The existing invite API already inserts an `Invite` row with `tokenHash` and logs to console. After inserting the Invite, also enqueue `send-email` with `{ kind: "INVITE", inviteId }`. The worker reads the invite, looks up the workspace name and inviter, and sends the email to `invite.email`. The invite's own token mechanics are untouched.

## Rate limiting

In the worker handler, before calling the provider: count non-failed `EmailToken` rows (or, for invites, count recent `send-email` job completions for the same `(email, kind)`) created in the last 10 minutes. If the count exceeds 3, the handler logs a warning and completes the job without sending. No user-visible error - we do not want to leak timing-sensitive signals from the `forgot` endpoint.

## Microsoft Graph provider

- Env:
  - `EMAIL_PROVIDER=graph`
  - `GRAPH_TENANT_ID`
  - `GRAPH_CLIENT_ID`
  - `GRAPH_CLIENT_SECRET`
  - `EMAIL_FROM_MAILBOX` (the sender UPN, e.g. `noreply@example.com`)
  - `EMAIL_FROM_NAME` optional display name
- Token acquisition: `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with `client_credentials` grant and `scope=https://graph.microsoft.com/.default`. Cache the access token in-memory in the worker process until 60 seconds before `expires_in`.
- Send: `POST https://graph.microsoft.com/v1.0/users/{mailbox}/sendMail` with the standard `message` body plus `saveToSentItems: false`.
- Errors map to: 401 / 403 -> terminal job failure (mark FAILED, no retry); 429 / 5xx -> pg-boss retry with backoff.

## UI changes

New pages and components under `apps/web/src`:

- `app/(auth)/verify-email/page.tsx` - server component consuming the token.
- `app/(auth)/forgot/page.tsx` - email input, posts to `/api/auth/forgot`.
- `app/(auth)/reset/page.tsx` - new password form, posts to `/api/auth/reset`.
- `components/VerifyEmailBanner.tsx` - client component, renders when `session.user.emailVerified` is null; has a "resend" button that posts `/api/me/verify-email/resend`.
- `/login` page gets a "Forgot password?" link.

## API routes

```
POST   /api/auth/forgot             {email} -> always 200
POST   /api/auth/reset              {token, password} -> 200 | 400 | 410
GET    /api/me/verify-email/consume {token=...} (via page) -> uses shared consume helper
POST   /api/me/verify-email/resend  -> enqueues a fresh VERIFY_EMAIL if unverified
```

No public "confirm" endpoint for password reset - the page itself posts to `reset`.

## Testing

- **Unit:** token hashing and expiry helpers in `packages/email/src/tokens.ts`.
- **Integration (real Postgres):**
  - `POST /api/auth/forgot` returns 200 for both known and unknown emails.
  - `POST /api/auth/reset` consumes once, rejects second use.
  - Signup enqueues a VERIFY_EMAIL job (inspect pg-boss table).
  - Worker handler with `EMAIL_PROVIDER=console`: invokes the template, logs output, writes consumable `EmailToken` row, respects rate limit.
  - Verify-email consume flips `User.emailVerified`, is idempotent on second consume.
- **E2E (Playwright):** signup triggers verification email (read from console output or from the DB `EmailToken` row in test mode), clicks the link, banner disappears.

## Deployment

- Add the new env vars to `.env.example`, `infra/coolify/env.example`, and the Coolify runbook.
- `infra/docker/Dockerfile.worker` and `Dockerfile.web` already copy all workspace `package.json` files; `packages/email` just gets added to the list.
- No new service. Worker handles the new job type.

## Documentation

- `docs/architecture.md` - add an "Email" section describing the provider abstraction, the pg-boss job type, and the token lifecycle.
- `docs/data-model.md` - document `EmailToken` and the `User.emailVerified` field.
- `docs/deployment.md` - Graph app registration steps and required env vars.
- `guides/email.md` - new end-user guide covering verification, password reset, and what the invite email looks like.

## Open items deferred to implementation

- Exact HTML template styles and branding; v0.2-A ships minimal, readable plain HTML.
- Graph retry backoff tuning (pg-boss defaults are fine to start).
- Whether the "resend verification email" button should be rate-limited in the UI separately from the worker-side rate limit.
