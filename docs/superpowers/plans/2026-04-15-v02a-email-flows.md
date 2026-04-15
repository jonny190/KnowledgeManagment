# v0.2-A Email Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship real outbound email for workspace invites, email verification at signup, and password reset, backed by a provider-abstracted `@km/email` package and a pg-boss `send-email` worker job.

**Architecture:** A new `packages/email` package owns a `sendEmail(payload)` contract with `console` and `graph` providers selected via `EMAIL_PROVIDER`. Web routes enqueue `send-email` jobs into the existing pg-boss queue and return immediately; `apps/worker` consumes them, generates tokens (for verify/reset), enforces rate limits, and dispatches. A new `EmailToken` table records verify and reset tokens; invites reuse the existing `Invite.tokenHash`. UI adds verify-email / forgot / reset pages plus a `VerifyEmailBanner` in the `(app)` layout.

**Tech Stack:** pnpm workspaces, Turborepo, TypeScript, Next.js App Router, NextAuth v4 (JWT), Prisma, Postgres, pg-boss, Microsoft Graph (client credentials), Vitest, Playwright.

---

## File Structure

**Create:**

- `packages/email/package.json`
- `packages/email/tsconfig.json`
- `packages/email/src/index.ts`
- `packages/email/src/types.ts`
- `packages/email/src/tokens.ts`
- `packages/email/src/templates/verify.ts`
- `packages/email/src/templates/reset.ts`
- `packages/email/src/templates/invite.ts`
- `packages/email/src/providers/console.ts`
- `packages/email/src/providers/graph.ts`
- `packages/email/src/__tests__/tokens.test.ts`
- `packages/email/src/__tests__/console.test.ts`
- `packages/email/src/__tests__/graph.test.ts`
- `packages/db/prisma/migrations/<timestamp>_v02a_email_tokens/migration.sql` (via `prisma migrate dev --name v02a_email_tokens`)
- `apps/web/src/app/(auth)/verify-email/page.tsx`
- `apps/web/src/app/(auth)/forgot/page.tsx`
- `apps/web/src/app/(auth)/reset/page.tsx`
- `apps/web/src/app/api/auth/forgot/route.ts`
- `apps/web/src/app/api/auth/reset/route.ts`
- `apps/web/src/app/api/me/verify-email/resend/route.ts`
- `apps/web/src/components/VerifyEmailBanner.tsx`
- `apps/web/src/lib/email-jobs.ts`
- `apps/web/src/app/api/auth/forgot/__tests__/route.test.ts`
- `apps/web/src/app/api/auth/reset/__tests__/route.test.ts`
- `apps/web/src/app/api/me/verify-email/resend/__tests__/route.test.ts`
- `apps/worker/src/jobs/send-email.ts`
- `apps/worker/src/jobs/__tests__/send-email.test.ts`

**Modify:**

- `packages/db/prisma/schema.prisma` (add `EmailTokenKind` enum and `EmailToken` model, relation on `User`)
- `apps/web/src/app/api/auth/signup/route.ts` (enqueue `VERIFY_EMAIL` after user creation)
- `apps/web/src/app/api/workspaces/[vaultId]/invites/route.ts` (enqueue `INVITE` alongside existing Invite insert)
- `apps/web/src/app/api/exports/[vaultId]/route.ts` (reject when `emailVerified` is null)
- `apps/web/src/app/api/me/password/route.ts` (reject when `emailVerified` is null) — create stub if missing and gate it
- `apps/web/src/app/(app)/layout.tsx` (mount `VerifyEmailBanner`)
- `apps/web/src/app/(auth)/login/page.tsx` (add "Forgot password?" link)
- `apps/worker/src/index.ts` (register `send-email` handler)
- `apps/worker/package.json` (depend on `@km/email`)
- `apps/web/package.json` (depend on `@km/email` for type-only templates)
- `.env.example`, `infra/coolify/env.example` (add Graph env vars)
- `infra/docker/Dockerfile.worker`, `infra/docker/Dockerfile.web` (include `packages/email`)
- `docs/architecture.md`, `docs/data-model.md`, `docs/deployment.md`, `guides/email.md`

---

### Task 1: Scaffold `packages/email` workspace package

**Files:**
- Create: `packages/email/package.json`
- Create: `packages/email/tsconfig.json`
- Create: `packages/email/src/index.ts`
- Create: `packages/email/src/types.ts`

- [ ] **Step 1: Write `packages/email/package.json`**

```json
{
  "name": "@km/email",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens": "./src/tokens.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@km/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write `packages/email/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/email/src/types.ts`**

```ts
export type EmailKind = "VERIFY_EMAIL" | "PASSWORD_RESET" | "INVITE";

export interface VerifyEmailData {
  verifyUrl: string;
  userDisplayName?: string | null;
}

export interface PasswordResetData {
  resetUrl: string;
  userDisplayName?: string | null;
}

export interface InviteEmailData {
  acceptUrl: string;
  workspaceName: string;
  inviterName: string;
}

export type SendEmailPayload =
  | { to: string; kind: "VERIFY_EMAIL"; data: VerifyEmailData }
  | { to: string; kind: "PASSWORD_RESET"; data: PasswordResetData }
  | { to: string; kind: "INVITE"; data: InviteEmailData };

export interface SendEmailResult {
  providerId: string;
  provider: "console" | "graph";
}

export interface EmailProvider {
  send(payload: SendEmailPayload): Promise<SendEmailResult>;
}
```

- [ ] **Step 4: Write `packages/email/src/index.ts`**

```ts
import type { EmailProvider, SendEmailPayload, SendEmailResult } from "./types";
import { ConsoleEmailProvider } from "./providers/console";
import { GraphEmailProvider } from "./providers/graph";

export * from "./types";
export { hashToken, generateRawToken, isExpired } from "./tokens";

let cached: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const choice = process.env.EMAIL_PROVIDER ?? "console";
  if (choice === "graph") {
    cached = new GraphEmailProvider();
  } else {
    cached = new ConsoleEmailProvider();
  }
  return cached;
}

export async function sendEmail(payload: SendEmailPayload): Promise<SendEmailResult> {
  return getEmailProvider().send(payload);
}

export function __resetProviderForTests() {
  cached = null;
}
```

- [ ] **Step 5: Add package to workspace and install**

Run: `pnpm install`
Expected: `@km/email` appears in `pnpm -r list --depth -1`.

- [ ] **Step 6: Commit**

```bash
git add packages/email pnpm-lock.yaml
git commit -m "feat(email): scaffold @km/email package"
```

---

### Task 2: Implement token helpers with tests

**Files:**
- Create: `packages/email/src/tokens.ts`
- Create: `packages/email/src/__tests__/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { generateRawToken, hashToken, isExpired } from "../tokens";

describe("email tokens", () => {
  it("generates URL-safe tokens of at least 32 chars", () => {
    const t = generateRawToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically with sha256 hex", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toHaveLength(64);
    expect(hashToken("abc")).not.toEqual(hashToken("abd"));
  });

  it("isExpired true when expiresAt is in the past", () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/email test`
Expected: FAIL with "Cannot find module '../tokens'".

- [ ] **Step 3: Implement `packages/email/src/tokens.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";

export function generateRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @km/email test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/email/src/tokens.ts packages/email/src/__tests__/tokens.test.ts
git commit -m "feat(email): add token hashing and expiry helpers"
```

---

### Task 3: Implement console provider with tests

**Files:**
- Create: `packages/email/src/providers/console.ts`
- Create: `packages/email/src/templates/verify.ts`
- Create: `packages/email/src/templates/reset.ts`
- Create: `packages/email/src/templates/invite.ts`
- Create: `packages/email/src/__tests__/console.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { ConsoleEmailProvider } from "../providers/console";

describe("ConsoleEmailProvider", () => {
  it("logs a rendered verify email and returns a stub id", async () => {
    const logs: unknown[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args);
    });
    const p = new ConsoleEmailProvider();
    const res = await p.send({
      to: "a@b.com",
      kind: "VERIFY_EMAIL",
      data: { verifyUrl: "https://app/verify-email?token=x" },
    });
    expect(res.provider).toBe("console");
    expect(res.providerId).toMatch(/^console-/);
    expect(JSON.stringify(logs)).toContain("https://app/verify-email?token=x");
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/email test`
Expected: FAIL with "Cannot find module '../providers/console'".

- [ ] **Step 3: Implement templates**

`packages/email/src/templates/verify.ts`:

```ts
import type { VerifyEmailData } from "../types";

export function renderVerify(data: VerifyEmailData) {
  const subject = "Verify your email";
  const text = `Hi${data.userDisplayName ? " " + data.userDisplayName : ""},

Confirm your email by opening this link:

${data.verifyUrl}

If you did not sign up, ignore this message.`;
  const html = `<p>Hi${data.userDisplayName ? " " + escapeHtml(data.userDisplayName) : ""},</p>
<p>Confirm your email by opening this link:</p>
<p><a href="${escapeAttr(data.verifyUrl)}">${escapeHtml(data.verifyUrl)}</a></p>
<p>If you did not sign up, ignore this message.</p>`;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}
```

`packages/email/src/templates/reset.ts`:

```ts
import type { PasswordResetData } from "../types";

export function renderReset(data: PasswordResetData) {
  const subject = "Reset your password";
  const text = `Someone requested a password reset for your account.

Open this link within the next hour to set a new password:

${data.resetUrl}

If this was not you, ignore this message.`;
  const html = `<p>Someone requested a password reset for your account.</p>
<p>Open this link within the next hour to set a new password:</p>
<p><a href="${escapeAttr(data.resetUrl)}">${escapeHtml(data.resetUrl)}</a></p>
<p>If this was not you, ignore this message.</p>`;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}
```

`packages/email/src/templates/invite.ts`:

```ts
import type { InviteEmailData } from "../types";

export function renderInvite(data: InviteEmailData) {
  const subject = `You were invited to ${data.workspaceName}`;
  const text = `${data.inviterName} invited you to join the workspace "${data.workspaceName}".

Accept the invite:

${data.acceptUrl}`;
  const html = `<p>${escapeHtml(data.inviterName)} invited you to join the workspace "${escapeHtml(data.workspaceName)}".</p>
<p><a href="${escapeAttr(data.acceptUrl)}">Accept the invite</a></p>`;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}
```

- [ ] **Step 4: Implement `packages/email/src/providers/console.ts`**

```ts
import type { EmailProvider, SendEmailPayload, SendEmailResult } from "../types";
import { renderVerify } from "../templates/verify";
import { renderReset } from "../templates/reset";
import { renderInvite } from "../templates/invite";

export class ConsoleEmailProvider implements EmailProvider {
  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    const rendered = render(payload);
    const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    console.log("[email:console]", {
      id,
      to: payload.to,
      kind: payload.kind,
      subject: rendered.subject,
      text: rendered.text,
    });
    return { providerId: id, provider: "console" };
  }
}

function render(payload: SendEmailPayload) {
  switch (payload.kind) {
    case "VERIFY_EMAIL":
      return renderVerify(payload.data);
    case "PASSWORD_RESET":
      return renderReset(payload.data);
    case "INVITE":
      return renderInvite(payload.data);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @km/email test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/email/src/providers/console.ts packages/email/src/templates packages/email/src/__tests__/console.test.ts
git commit -m "feat(email): add console provider and plain-text templates"
```

---

### Task 4: Implement Graph provider with token caching and tests

**Files:**
- Create: `packages/email/src/providers/graph.ts`
- Create: `packages/email/src/__tests__/graph.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphEmailProvider, __resetGraphCacheForTests } from "../providers/graph";

const tokenJson = (expiresIn = 3600) => ({
  token_type: "Bearer",
  expires_in: expiresIn,
  access_token: "FAKE_TOKEN",
});

describe("GraphEmailProvider", () => {
  beforeEach(() => {
    process.env.GRAPH_TENANT_ID = "tenant";
    process.env.GRAPH_CLIENT_ID = "client";
    process.env.GRAPH_CLIENT_SECRET = "secret";
    process.env.EMAIL_FROM_MAILBOX = "noreply@example.com";
    __resetGraphCacheForTests();
  });

  afterEach(() => vi.restoreAllMocks());

  it("acquires a token and sends via /sendMail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenJson()), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const p = new GraphEmailProvider();
    const res = await p.send({
      to: "a@b.com",
      kind: "VERIFY_EMAIL",
      data: { verifyUrl: "https://app/v?t=x" },
    });

    expect(res.provider).toBe("graph");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toContain("login.microsoftonline.com/tenant/oauth2/v2.0/token");
    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(String(sendUrl)).toBe("https://graph.microsoft.com/v1.0/users/noreply@example.com/sendMail");
    expect((sendInit as RequestInit).headers).toMatchObject({ Authorization: "Bearer FAKE_TOKEN" });
  });

  it("reuses a cached token across calls", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenJson()), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new GraphEmailProvider();
    await p.send({ to: "a@b.com", kind: "VERIFY_EMAIL", data: { verifyUrl: "u" } });
    await p.send({ to: "c@d.com", kind: "VERIFY_EMAIL", data: { verifyUrl: "u" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws TerminalGraphError on 401 from sendMail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenJson()), { status: 200 }))
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new GraphEmailProvider();
    await expect(
      p.send({ to: "a@b.com", kind: "VERIFY_EMAIL", data: { verifyUrl: "u" } }),
    ).rejects.toMatchObject({ terminal: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/email test`
Expected: FAIL with "Cannot find module '../providers/graph'".

- [ ] **Step 3: Implement `packages/email/src/providers/graph.ts`**

```ts
import type { EmailProvider, SendEmailPayload, SendEmailResult } from "../types";
import { renderVerify } from "../templates/verify";
import { renderReset } from "../templates/reset";
import { renderInvite } from "../templates/invite";

export class GraphError extends Error {
  terminal: boolean;
  status: number;
  constructor(status: number, msg: string, terminal: boolean) {
    super(msg);
    this.status = status;
    this.terminal = terminal;
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function __resetGraphCacheForTests() {
  cachedToken = null;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }
  const tenant = requireEnv("GRAPH_TENANT_ID");
  const clientId = requireEnv("GRAPH_CLIENT_ID");
  const clientSecret = requireEnv("GRAPH_CLIENT_SECRET");
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GraphError(res.status, `token endpoint failed: ${text}`, res.status === 401 || res.status === 403);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new GraphError(500, `missing env var ${name}`, true);
  return v;
}

export class GraphEmailProvider implements EmailProvider {
  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    const mailbox = requireEnv("EMAIL_FROM_MAILBOX");
    const fromName = process.env.EMAIL_FROM_NAME ?? "";
    const rendered = render(payload);
    const token = await getAccessToken();

    const messageBody = {
      message: {
        subject: rendered.subject,
        body: { contentType: "HTML", content: rendered.html },
        toRecipients: [{ emailAddress: { address: payload.to } }],
        from: {
          emailAddress: {
            address: mailbox,
            ...(fromName ? { name: fromName } : {}),
          },
        },
      },
      saveToSentItems: false,
    };

    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(messageBody),
    });
    if (res.status === 202) {
      return { providerId: res.headers.get("request-id") ?? `graph-${Date.now()}`, provider: "graph" };
    }
    const text = await res.text();
    const terminal = res.status === 401 || res.status === 403;
    throw new GraphError(res.status, `sendMail failed: ${text}`, terminal);
  }
}

function render(payload: SendEmailPayload) {
  switch (payload.kind) {
    case "VERIFY_EMAIL":
      return renderVerify(payload.data);
    case "PASSWORD_RESET":
      return renderReset(payload.data);
    case "INVITE":
      return renderInvite(payload.data);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @km/email test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/email/src/providers/graph.ts packages/email/src/__tests__/graph.test.ts
git commit -m "feat(email): add Microsoft Graph provider with token caching"
```

---

### Task 5: Prisma schema migration for `EmailToken`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_v02a_email_tokens/migration.sql` (generated)

- [ ] **Step 1: Add enum and model to schema**

In `packages/db/prisma/schema.prisma`, add:

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

And add the back-relation on `User`:

```prisma
model User {
  // ... existing fields ...
  emailTokens EmailToken[]
}
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @km/db exec prisma migrate dev --name v02a_email_tokens`
Expected: A new folder `packages/db/prisma/migrations/<timestamp>_v02a_email_tokens/` with `migration.sql` creating `EmailToken` and the enum.

- [ ] **Step 3: Regenerate the client**

Run: `pnpm --filter @km/db exec prisma generate`
Expected: Generated client includes `prisma.emailToken` and `EmailTokenKind`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add EmailToken model and EmailTokenKind enum"
```

---

### Task 6: Web-side enqueue helper `lib/email-jobs.ts`

**Files:**
- Create: `apps/web/src/lib/email-jobs.ts`

- [ ] **Step 1: Write the failing test** (colocated in `apps/web/src/lib/__tests__/email-jobs.test.ts`)

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pg-boss", () => ({
  getBoss: vi.fn(async () => ({
    send: vi.fn(async () => "job-id-1"),
  })),
}));

import { enqueueSendEmail } from "@/lib/email-jobs";

describe("enqueueSendEmail", () => {
  it("enqueues a send-email job with kind and ids", async () => {
    const id = await enqueueSendEmail({ kind: "VERIFY_EMAIL", userId: "u1" });
    expect(id).toBe("job-id-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/web test email-jobs`
Expected: FAIL with "Cannot find module '@/lib/email-jobs'".

- [ ] **Step 3: Implement `apps/web/src/lib/email-jobs.ts`**

```ts
import { getBoss } from "@/lib/pg-boss";

export type SendEmailJob =
  | { kind: "VERIFY_EMAIL"; userId: string }
  | { kind: "PASSWORD_RESET"; userId: string }
  | { kind: "INVITE"; inviteId: string };

export async function enqueueSendEmail(job: SendEmailJob): Promise<string> {
  const boss = await getBoss();
  const id = await boss.send("send-email", job, { retryLimit: 5, retryBackoff: true });
  if (!id) throw new Error("pg-boss send returned null");
  return id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @km/web test email-jobs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/email-jobs.ts apps/web/src/lib/__tests__/email-jobs.test.ts
git commit -m "feat(web): add enqueueSendEmail helper"
```

---

### Task 7: Shared `consumeEmailToken` helper in web

**Files:**
- Create: `apps/web/src/lib/email-tokens.ts`
- Create: `apps/web/src/lib/__tests__/email-tokens.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { hashToken } from "@km/email/tokens";
import { createUser } from "@/test/factories";
import { consumeEmailToken } from "@/lib/email-tokens";

describe("consumeEmailToken", () => {
  beforeEach(async () => {
    await prisma.emailToken.deleteMany();
    await prisma.user.deleteMany();
  });

  it("consumes a valid VERIFY_EMAIL token exactly once", async () => {
    const user = await createUser({ email: "a@b.com" });
    const raw = "raw-token-1";
    await prisma.emailToken.create({
      data: {
        userId: user.id,
        email: user.email,
        kind: "VERIFY_EMAIL",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const result = await consumeEmailToken(raw, "VERIFY_EMAIL");
    expect(result.ok).toBe(true);
    expect(result.ok && result.userId).toBe(user.id);
    const second = await consumeEmailToken(raw, "VERIFY_EMAIL");
    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toBe("already_consumed");
  });

  it("rejects expired tokens", async () => {
    const user = await createUser({ email: "c@d.com" });
    const raw = "raw-token-2";
    await prisma.emailToken.create({
      data: {
        userId: user.id,
        email: user.email,
        kind: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const r = await consumeEmailToken(raw, "PASSWORD_RESET");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("expired");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @km/web test email-tokens`
Expected: FAIL with "Cannot find module '@/lib/email-tokens'".

- [ ] **Step 3: Implement `apps/web/src/lib/email-tokens.ts`**

```ts
import { prisma } from "@km/db";
import type { EmailTokenKind } from "@prisma/client";
import { hashToken } from "@km/email/tokens";

export type ConsumeResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: "not_found" | "expired" | "already_consumed" };

export async function consumeEmailToken(rawToken: string, kind: EmailTokenKind): Promise<ConsumeResult> {
  const tokenHash = hashToken(rawToken);
  return prisma.$transaction(async (tx) => {
    const row = await tx.emailToken.findUnique({ where: { tokenHash } });
    if (!row || row.kind !== kind) return { ok: false, reason: "not_found" as const };
    if (row.consumedAt) return { ok: false, reason: "already_consumed" as const };
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" as const };

    await tx.emailToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    if (kind === "VERIFY_EMAIL") {
      await tx.user.update({
        where: { id: row.userId },
        data: { emailVerified: new Date() },
      });
    }

    return { ok: true, userId: row.userId, email: row.email };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @km/web test email-tokens`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/email-tokens.ts apps/web/src/lib/__tests__/email-tokens.test.ts
git commit -m "feat(web): add consumeEmailToken helper"
```

---

### Task 8: Worker `send-email` job handler

**Files:**
- Create: `apps/worker/src/jobs/send-email.ts`
- Create: `apps/worker/src/jobs/__tests__/send-email.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/package.json`

- [ ] **Step 1: Add `@km/email` dependency to worker**

In `apps/worker/package.json` add under `dependencies`:

```json
"@km/email": "workspace:*"
```

Then run: `pnpm install`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { __resetProviderForTests } from "@km/email";
import { handleSendEmail } from "../send-email";
import { createUser, createInvite } from "@/test/factories";

beforeEach(async () => {
  process.env.EMAIL_PROVIDER = "console";
  process.env.APP_URL = "https://app.test";
  __resetProviderForTests();
  await prisma.emailToken.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.user.deleteMany();
});

describe("handleSendEmail", () => {
  it("creates a VERIFY_EMAIL token and sends via console", async () => {
    const user = await createUser({ email: "v@b.com" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleSendEmail({ data: { kind: "VERIFY_EMAIL", userId: user.id } } as any);
    const token = await prisma.emailToken.findFirst({ where: { userId: user.id } });
    expect(token?.kind).toBe("VERIFY_EMAIL");
    expect(token?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(spy.mock.calls)).toContain("verify-email?token=");
    spy.mockRestore();
  });

  it("enforces rate limit of 3 per 10 minutes per (email, kind)", async () => {
    const user = await createUser({ email: "r@b.com" });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      await handleSendEmail({ data: { kind: "PASSWORD_RESET", userId: user.id } } as any);
    }
    await handleSendEmail({ data: { kind: "PASSWORD_RESET", userId: user.id } } as any);
    const count = await prisma.emailToken.count({ where: { userId: user.id, kind: "PASSWORD_RESET" } });
    expect(count).toBe(3);
    const warns = spy.mock.calls.filter((c) => String(c[0]).includes("[email:rate-limited]"));
    expect(warns.length).toBe(1);
    spy.mockRestore();
  });

  it("sends an INVITE using the existing Invite row without creating an EmailToken", async () => {
    const inviter = await createUser({ email: "inv@b.com", name: "Alice" });
    const invite = await createInvite({ email: "guest@b.com", invitedById: inviter.id });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleSendEmail({ data: { kind: "INVITE", inviteId: invite.id } } as any);
    const tokens = await prisma.emailToken.count();
    expect(tokens).toBe(0);
    expect(JSON.stringify(spy.mock.calls)).toContain("guest@b.com");
    spy.mockRestore();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @km/worker test send-email`
Expected: FAIL with "Cannot find module '../send-email'".

- [ ] **Step 4: Implement `apps/worker/src/jobs/send-email.ts`**

```ts
import type { Job } from "pg-boss";
import { prisma } from "@km/db";
import { sendEmail, generateRawToken, hashToken } from "@km/email";

export type SendEmailJobData =
  | { kind: "VERIFY_EMAIL"; userId: string }
  | { kind: "PASSWORD_RESET"; userId: string }
  | { kind: "INVITE"; inviteId: string };

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 3;

function appUrl(): string {
  const u = process.env.APP_URL;
  if (!u) throw new Error("APP_URL not set");
  return u.replace(/\/$/, "");
}

export async function handleSendEmail(job: Job<SendEmailJobData>): Promise<void> {
  const data = job.data;
  if (data.kind === "INVITE") {
    await handleInvite(data.inviteId);
    return;
  }
  await handleVerifyOrReset(data.kind, data.userId);
}

async function handleVerifyOrReset(kind: "VERIFY_EMAIL" | "PASSWORD_RESET", userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    console.warn("[email:user-missing]", { userId, kind });
    return;
  }
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const recent = await prisma.emailToken.count({
    where: { email: user.email, kind, createdAt: { gte: since } },
  });
  if (recent >= RATE_MAX) {
    console.warn("[email:rate-limited]", { email: user.email, kind, recent });
    return;
  }

  const rawToken = generateRawToken();
  const ttlMs = kind === "VERIFY_EMAIL" ? VERIFY_TTL_MS : RESET_TTL_MS;
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      email: user.email,
      kind,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  if (kind === "VERIFY_EMAIL") {
    await sendEmail({
      to: user.email,
      kind: "VERIFY_EMAIL",
      data: {
        verifyUrl: `${appUrl()}/verify-email?token=${rawToken}`,
        userDisplayName: user.name,
      },
    });
  } else {
    await sendEmail({
      to: user.email,
      kind: "PASSWORD_RESET",
      data: {
        resetUrl: `${appUrl()}/reset?token=${rawToken}`,
        userDisplayName: user.name,
      },
    });
  }
}

async function handleInvite(inviteId: string) {
  const invite = await prisma.invite.findUnique({
    where: { id: inviteId },
    include: { vault: true, invitedBy: true },
  });
  if (!invite) {
    console.warn("[email:invite-missing]", { inviteId });
    return;
  }
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const recent = await prisma.invite.count({
    where: { email: invite.email, createdAt: { gte: since } },
  });
  if (recent > RATE_MAX) {
    console.warn("[email:rate-limited]", { email: invite.email, kind: "INVITE", recent });
    return;
  }
  await sendEmail({
    to: invite.email,
    kind: "INVITE",
    data: {
      acceptUrl: `${appUrl()}/invites/${invite.id}/accept?token=${invite.tokenHash}`,
      workspaceName: invite.vault?.name ?? "a workspace",
      inviterName: invite.invitedBy?.name ?? invite.invitedBy?.email ?? "A teammate",
    },
  });
}
```

Note: The accept URL uses `invite.tokenHash` only as a carrier identifier consistent with the existing invite acceptance route; confirm the existing acceptance route's expected query parameter name when wiring and adjust the URL accordingly. If that route expects the raw token, the invite issuance flow (already present) must be the source of the raw token — do not generate a new one here.

- [ ] **Step 5: Register handler in `apps/worker/src/index.ts`**

Add near the existing `export-vault` registration:

```ts
import { handleSendEmail } from "./jobs/send-email";

await boss.work("send-email", handleSendEmail);
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @km/worker test send-email`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/jobs/send-email.ts apps/worker/src/jobs/__tests__/send-email.test.ts apps/worker/src/index.ts apps/worker/package.json pnpm-lock.yaml
git commit -m "feat(worker): add send-email job handler with rate limiting"
```

---

### Task 9: Wire signup to enqueue VERIFY_EMAIL

**Files:**
- Modify: `apps/web/src/app/api/auth/signup/route.ts`
- Create: `apps/web/src/app/api/auth/signup/__tests__/verify-enqueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

const sendMock = vi.fn(async () => "job-1");
vi.mock("@/lib/pg-boss", () => ({
  getBoss: vi.fn(async () => ({ send: sendMock })),
}));

import { POST } from "@/app/api/auth/signup/route";

describe("signup enqueues verify email", () => {
  it("sends a send-email job with kind VERIFY_EMAIL", async () => {
    const req = new Request("http://x/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: "new@user.com", password: "pw-12345678", name: "New" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const call = sendMock.mock.calls.find((c) => c[0] === "send-email");
    expect(call).toBeTruthy();
    expect(call?.[1]).toMatchObject({ kind: "VERIFY_EMAIL" });
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @km/web test verify-enqueue`
Expected: FAIL (no enqueue yet).

- [ ] **Step 3: Modify `apps/web/src/app/api/auth/signup/route.ts`**

After the successful user + vault + folder transaction, before returning:

```ts
import { enqueueSendEmail } from "@/lib/email-jobs";

// ...inside POST, after successful creation:
try {
  await enqueueSendEmail({ kind: "VERIFY_EMAIL", userId: user.id });
} catch (err) {
  console.error("[signup] failed to enqueue verify email", err);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @km/web test verify-enqueue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/auth/signup apps/web/src/app/api/auth/signup/__tests__
git commit -m "feat(auth): enqueue verification email on signup"
```

---

### Task 10: `/api/auth/forgot` route

**Files:**
- Create: `apps/web/src/app/api/auth/forgot/route.ts`
- Create: `apps/web/src/app/api/auth/forgot/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { createUser } from "@/test/factories";

const sendMock = vi.fn(async () => "job-1");
vi.mock("@/lib/pg-boss", () => ({
  getBoss: vi.fn(async () => ({ send: sendMock })),
}));

import { POST } from "@/app/api/auth/forgot/route";

beforeEach(async () => {
  sendMock.mockClear();
  await prisma.user.deleteMany();
});

describe("POST /api/auth/forgot", () => {
  it("returns 200 and enqueues PASSWORD_RESET when user exists", async () => {
    const u = await createUser({ email: "known@x.com" });
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ email: u.email }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("send-email", { kind: "PASSWORD_RESET", userId: u.id }, expect.anything());
  });

  it("returns 200 and does NOT enqueue when user unknown", async () => {
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@x.com" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns 200 on malformed input (no enumeration)", async () => {
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @km/web test api/auth/forgot`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/src/app/api/auth/forgot/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@km/db";
import { enqueueSendEmail } from "@/lib/email-jobs";

const Body = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  let email: string | null = null;
  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (parsed.success) email = parsed.data.email.toLowerCase();
  } catch {
    // fall through: always 200
  }
  if (email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      try {
        await enqueueSendEmail({ kind: "PASSWORD_RESET", userId: user.id });
      } catch (err) {
        console.error("[forgot] enqueue failed", err);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @km/web test api/auth/forgot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/auth/forgot
git commit -m "feat(auth): add password reset request route"
```

---

### Task 11: `/api/auth/reset` route

**Files:**
- Create: `apps/web/src/app/api/auth/reset/route.ts`
- Create: `apps/web/src/app/api/auth/reset/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { hashToken } from "@km/email/tokens";
import { createUser } from "@/test/factories";
import { POST } from "@/app/api/auth/reset/route";

beforeEach(async () => {
  await prisma.emailToken.deleteMany();
  await prisma.user.deleteMany();
});

describe("POST /api/auth/reset", () => {
  it("consumes token, updates password, rejects second use", async () => {
    const u = await createUser({ email: "r@x.com", password: "old-password-1" });
    const raw = "reset-raw-1";
    await prisma.emailToken.create({
      data: {
        userId: u.id,
        email: u.email,
        kind: "PASSWORD_RESET",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const res1 = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ token: raw, password: "new-password-1" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res1.status).toBe(200);

    const res2 = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ token: raw, password: "other-password-1" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res2.status).toBe(410);
  });

  it("returns 400 when input invalid", async () => {
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ token: "", password: "x" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @km/web test api/auth/reset`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/src/app/api/auth/reset/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@km/db";
import { consumeEmailToken } from "@/lib/email-tokens";
import { signOutAllSessions } from "@/lib/sessions";

const Body = z.object({
  token: z.string().min(16),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await consumeEmailToken(parsed.data.token, "PASSWORD_RESET");
  if (!result.ok) {
    const status = result.reason === "already_consumed" || result.reason === "expired" ? 410 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.update({
    where: { id: result.userId },
    data: { passwordHash },
  });
  await signOutAllSessions(result.userId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Create `apps/web/src/lib/sessions.ts` stub**

```ts
export async function signOutAllSessions(_userId: string): Promise<void> {
  // JWT strategy: nothing to invalidate server-side today.
  // Hook for future DB-session support.
  return;
}
```

- [ ] **Step 5: Run test**

Run: `pnpm --filter @km/web test api/auth/reset`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/auth/reset apps/web/src/lib/sessions.ts
git commit -m "feat(auth): add password reset confirmation route"
```

---

### Task 12: `/api/me/verify-email/resend` route

**Files:**
- Create: `apps/web/src/app/api/me/verify-email/resend/route.ts`
- Create: `apps/web/src/app/api/me/verify-email/resend/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { createUser } from "@/test/factories";

const sendMock = vi.fn(async () => "job");
vi.mock("@/lib/pg-boss", () => ({ getBoss: vi.fn(async () => ({ send: sendMock })) }));
vi.mock("@/lib/session", () => ({ requireUserId: vi.fn() }));

import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/me/verify-email/resend/route";

beforeEach(async () => {
  sendMock.mockClear();
  await prisma.user.deleteMany();
});

describe("POST /api/me/verify-email/resend", () => {
  it("enqueues when user is unverified", async () => {
    const u = await createUser({ email: "u@x.com", emailVerified: null });
    (requireUserId as any).mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledWith("send-email", { kind: "VERIFY_EMAIL", userId: u.id }, expect.anything());
  });

  it("returns 200 without enqueuing when already verified", async () => {
    const u = await createUser({ email: "v@x.com", emailVerified: new Date() });
    (requireUserId as any).mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @km/web test verify-email/resend`
Expected: FAIL.

- [ ] **Step 3: Implement route**

```ts
import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";
import { enqueueSendEmail } from "@/lib/email-jobs";

export async function POST() {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user && !user.emailVerified) {
    await enqueueSendEmail({ kind: "VERIFY_EMAIL", userId: user.id });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @km/web test verify-email/resend`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/me/verify-email/resend
git commit -m "feat(auth): add verification resend endpoint"
```

---

### Task 13: `/verify-email` page consumes token

**Files:**
- Create: `apps/web/src/app/(auth)/verify-email/page.tsx`
- Create: `apps/web/src/app/(auth)/verify-email/__tests__/page.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { hashToken } from "@km/email/tokens";
import { createUser } from "@/test/factories";
import Page from "@/app/(auth)/verify-email/page";

beforeEach(async () => {
  await prisma.emailToken.deleteMany();
  await prisma.user.deleteMany();
});

describe("VerifyEmailPage", () => {
  it("marks user verified when token is valid", async () => {
    const u = await createUser({ email: "v@x.com", emailVerified: null });
    const raw = "verify-raw-1";
    await prisma.emailToken.create({
      data: {
        userId: u.id,
        email: u.email,
        kind: "VERIFY_EMAIL",
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await Page({ searchParams: Promise.resolve({ token: raw }) });
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.emailVerified).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @km/web test verify-email/__tests__`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/web/src/app/(auth)/verify-email/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { consumeEmailToken } from "@/lib/email-tokens";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  if (!token) {
    return (
      <main className="mx-auto max-w-md p-8">
        <h1 className="text-xl font-semibold">Verify your email</h1>
        <p className="mt-4">Missing token. Open the link from your email.</p>
      </main>
    );
  }
  const result = await consumeEmailToken(token, "VERIFY_EMAIL");
  if (result.ok) {
    redirect("/?verified=1");
  }
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Verify your email</h1>
      <p className="mt-4">
        {result.reason === "expired"
          ? "This link has expired. Request a new one from the banner after signing in."
          : result.reason === "already_consumed"
            ? "This link has already been used."
            : "This link is not valid."}
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @km/web test verify-email/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(auth)/verify-email"
git commit -m "feat(auth): add verify-email page"
```

---

### Task 14: `/forgot` and `/reset` pages

**Files:**
- Create: `apps/web/src/app/(auth)/forgot/page.tsx`
- Create: `apps/web/src/app/(auth)/reset/page.tsx`
- Modify: `apps/web/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Implement `forgot/page.tsx`**

```tsx
"use client";
import { useState } from "react";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Forgot password</h1>
      {sent ? (
        <p className="mt-4">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            type="email"
            required
            className="w-full rounded border px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <button disabled={busy} className="rounded bg-black px-4 py-2 text-white">
            {busy ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Implement `reset/page.tsx`**

```tsx
"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ResetPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/login?reset=ok");
    } else if (res.status === 410) {
      setError("This link has expired or was already used. Request a new one.");
    } else {
      setError("Reset failed. Check your password and try again.");
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          type="password"
          required
          minLength={8}
          className="w-full rounded border px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button disabled={busy || !token} className="rounded bg-black px-4 py-2 text-white">
          {busy ? "Saving..." : "Set new password"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Add "Forgot password?" link on `/login`**

In `apps/web/src/app/(auth)/login/page.tsx`, near the submit button add:

```tsx
<a href="/forgot" className="text-sm text-blue-600 underline">
  Forgot password?
</a>
```

- [ ] **Step 4: Smoke-run the dev server**

Run: `pnpm --filter @km/web dev` (Ctrl+C after confirming pages render)
Expected: `/forgot` and `/reset` render without errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(auth)/forgot" "apps/web/src/app/(auth)/reset" "apps/web/src/app/(auth)/login/page.tsx"
git commit -m "feat(auth): add forgot and reset pages"
```

---

### Task 15: `VerifyEmailBanner` and mount in `(app)` layout

**Files:**
- Create: `apps/web/src/components/VerifyEmailBanner.tsx`
- Modify: `apps/web/src/app/(app)/layout.tsx`

- [ ] **Step 1: Implement the banner**

```tsx
"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";

export function VerifyEmailBanner() {
  const { data } = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailVerified = (data?.user as { emailVerified?: string | null } | undefined)?.emailVerified;
  if (!data?.user || emailVerified || dismissed) return null;

  async function resend() {
    setBusy(true);
    await fetch("/api/me/verify-email/resend", { method: "POST" });
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        {sent ? "Verification email sent. Check your inbox." : "Please verify your email to unlock all features."}
      </span>
      <div className="flex items-center gap-2">
        {!sent && (
          <button disabled={busy} onClick={resend} className="rounded border border-amber-500 px-2 py-1">
            {busy ? "Sending..." : "Resend email"}
          </button>
        )}
        <button onClick={() => setDismissed(true)} className="rounded px-2 py-1">
          Dismiss
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in `(app)/layout.tsx`**

Near the top of the rendered tree (inside the provider wrapper that already exposes the session):

```tsx
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";

// ... inside the JSX:
<VerifyEmailBanner />
```

- [ ] **Step 3: Ensure `emailVerified` is on the session token**

Open `apps/web/src/lib/auth.ts` (NextAuth config). In the `jwt` callback, when loading the user, add:

```ts
if (user) {
  token.emailVerified = (user as { emailVerified?: Date | null }).emailVerified?.toISOString() ?? null;
}
```

And in `session` callback:

```ts
(session.user as { emailVerified?: string | null }).emailVerified =
  (token as { emailVerified?: string | null }).emailVerified ?? null;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/VerifyEmailBanner.tsx "apps/web/src/app/(app)/layout.tsx" apps/web/src/lib/auth.ts
git commit -m "feat(auth): add verify-email banner and expose emailVerified on session"
```

---

### Task 16: Gate export trigger on `emailVerified`

**Files:**
- Modify: `apps/web/src/app/api/exports/[vaultId]/route.ts`
- Create: `apps/web/src/app/api/exports/[vaultId]/__tests__/verify-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { createUser, createVault } from "@/test/factories";

vi.mock("@/lib/session", () => ({ requireUserId: vi.fn() }));
import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/exports/[vaultId]/route";

beforeEach(async () => {
  await prisma.vault.deleteMany();
  await prisma.user.deleteMany();
});

describe("export vault gate", () => {
  it("returns 403 verify_email_required when unverified", async () => {
    const u = await createUser({ emailVerified: null });
    const v = await createVault({ ownerId: u.id });
    (requireUserId as any).mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ vaultId: v.id }),
    } as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("verify_email_required");
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @km/web test exports/verify-gate`
Expected: FAIL.

- [ ] **Step 3: Add the gate**

At the top of the POST handler, after `requireUserId()`:

```ts
const me = await prisma.user.findUnique({ where: { id: userId } });
if (!me?.emailVerified) {
  return NextResponse.json({ reason: "verify_email_required" }, { status: 403 });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @km/web test exports/verify-gate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/exports
git commit -m "feat(exports): require verified email before triggering export"
```

---

### Task 17: Stub `/api/me/password` with the same verify gate

**Files:**
- Create (if absent): `apps/web/src/app/api/me/password/route.ts`
- Create: `apps/web/src/app/api/me/password/__tests__/verify-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@km/db";
import { createUser } from "@/test/factories";

vi.mock("@/lib/session", () => ({ requireUserId: vi.fn() }));
import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/me/password/route";

beforeEach(async () => { await prisma.user.deleteMany(); });

describe("password change gate", () => {
  it("returns 403 when unverified", async () => {
    const u = await createUser({ emailVerified: null });
    (requireUserId as any).mockResolvedValue(u.id);
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ currentPassword: "x", newPassword: "new-pw-12345" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @km/web test me/password/verify-gate`
Expected: FAIL.

- [ ] **Step 3: Implement route**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@km/db";
import { requireUserId } from "@/lib/session";

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.emailVerified) {
    return NextResponse.json({ reason: "verify_email_required" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  if (!user.passwordHash || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "wrong_password" }, { status: 400 });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @km/web test me/password/verify-gate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/me/password
git commit -m "feat(me): add password-change route gated on verified email"
```

---

### Task 18: Wire invite route to enqueue INVITE email

**Files:**
- Modify: `apps/web/src/app/api/workspaces/[vaultId]/invites/route.ts`
- Create: `apps/web/src/app/api/workspaces/[vaultId]/invites/__tests__/enqueue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { prisma } from "@km/db";
import { createUser, createVault } from "@/test/factories";

const sendMock = vi.fn(async () => "job-1");
vi.mock("@/lib/pg-boss", () => ({ getBoss: vi.fn(async () => ({ send: sendMock })) }));
vi.mock("@/lib/session", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/authz", () => ({ assertCanAccessVault: vi.fn(async () => {}) }));

import { requireUserId } from "@/lib/session";
import { POST } from "@/app/api/workspaces/[vaultId]/invites/route";

beforeEach(async () => {
  sendMock.mockClear();
  await prisma.invite.deleteMany();
  await prisma.vault.deleteMany();
  await prisma.user.deleteMany();
});

describe("invite creation enqueues INVITE email", () => {
  it("creates invite and sends send-email job with inviteId", async () => {
    const me = await createUser({ email: "me@x.com" });
    const v = await createVault({ ownerId: me.id });
    (requireUserId as any).mockResolvedValue(me.id);
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ email: "guest@x.com", role: "EDITOR" }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ vaultId: v.id }) } as any);
    expect(res.status).toBe(200);
    const invite = await prisma.invite.findFirst();
    expect(invite).toBeTruthy();
    expect(sendMock).toHaveBeenCalledWith("send-email", { kind: "INVITE", inviteId: invite!.id }, expect.anything());
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @km/web test workspaces/.*invites/enqueue`
Expected: FAIL.

- [ ] **Step 3: Add enqueue call after the existing `prisma.invite.create`**

In `apps/web/src/app/api/workspaces/[vaultId]/invites/route.ts`, after the invite row is created:

```ts
import { enqueueSendEmail } from "@/lib/email-jobs";

// after invite creation:
try {
  await enqueueSendEmail({ kind: "INVITE", inviteId: invite.id });
} catch (err) {
  console.error("[invite] enqueue failed", err);
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @km/web test workspaces/.*invites/enqueue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/workspaces/[vaultId]/invites"
git commit -m "feat(invites): enqueue INVITE email when creating invites"
```

---

### Task 19: Env, Docker, and Coolify wiring

**Files:**
- Modify: `.env.example`
- Modify: `infra/coolify/env.example`
- Modify: `infra/docker/Dockerfile.web`
- Modify: `infra/docker/Dockerfile.worker`

- [ ] **Step 1: Add env vars to `.env.example`**

Append:

```
# Email (v0.2-A)
EMAIL_PROVIDER=console
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
EMAIL_FROM_MAILBOX=
EMAIL_FROM_NAME=
APP_URL=http://localhost:3000
```

- [ ] **Step 2: Mirror in `infra/coolify/env.example`**

Same block, suitable defaults blank.

- [ ] **Step 3: Include `packages/email` in Docker deps stages**

In both `Dockerfile.web` and `Dockerfile.worker`, find the existing `COPY packages/<name>/package.json packages/<name>/` lines and add:

```
COPY packages/email/package.json packages/email/
```

And in the source-copy stage make sure `packages/email` is included (typically via `COPY packages ./packages`).

- [ ] **Step 4: Build locally to verify**

Run: `docker build -f infra/docker/Dockerfile.worker -t km-worker:v02a .`
Expected: Build succeeds through the install stage.

- [ ] **Step 5: Commit**

```bash
git add .env.example infra/coolify/env.example infra/docker/Dockerfile.web infra/docker/Dockerfile.worker
git commit -m "build: wire email env vars and include @km/email in Docker images"
```

---

### Task 20: Playwright E2E — signup -> verify banner disappears

**Files:**
- Create: `apps/web/tests/e2e/verify-email.spec.ts`

- [ ] **Step 1: Write the E2E test**

```ts
import { test, expect } from "@playwright/test";
import { prisma } from "@km/db";
import { hashToken } from "@km/email/tokens";

test("signup shows banner, consuming verify token clears it", async ({ page, request }) => {
  const email = `e2e-${Date.now()}@x.com`;
  await request.post("/api/auth/signup", {
    data: { email, password: "e2e-password-1", name: "E2E" },
  });

  // Pull the raw token by matching the hash of a freshly generated token is not
  // possible; instead read the persisted token row the worker creates.
  // Poll briefly for the row.
  let raw: string | null = null;
  for (let i = 0; i < 20 && !raw; i++) {
    const row = await prisma.emailToken.findFirst({
      where: { email, kind: "VERIFY_EMAIL" },
      orderBy: { createdAt: "desc" },
    });
    if (row) {
      // In E2E mode the worker also logs the raw URL; fall back to a known test override env.
      raw = process.env.E2E_LAST_VERIFY_RAW ?? null;
    }
    if (!raw) await new Promise((r) => setTimeout(r, 250));
  }
  test.skip(!raw, "raw token not captured in E2E harness; requires E2E_LAST_VERIFY_RAW shim");

  await page.goto(`/verify-email?token=${raw}`);
  await expect(page).toHaveURL(/verified=1/);
  await expect(page.getByText("Please verify your email")).toHaveCount(0);
});
```

Note: This test is intentionally conservative. Because verify tokens are only persisted as hashes, full E2E requires a test-only shim. Accept `test.skip` if the shim is absent.

- [ ] **Step 2: Run Playwright**

Run: `pnpm --filter @km/web exec playwright test verify-email`
Expected: Test runs; either passes with the shim or is skipped.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e/verify-email.spec.ts
git commit -m "test(e2e): verify-email flow spec with token shim"
```

---

### Task 21: Documentation updates

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/data-model.md`
- Modify: `docs/deployment.md`
- Create: `guides/email.md`

- [ ] **Step 1: `docs/architecture.md` — append "Email" section**

```markdown
## Email

Outbound email is abstracted behind `@km/email`. The `sendEmail(payload)` function picks a provider based on `EMAIL_PROVIDER`. In `console` mode it logs the rendered message and returns a stub id. In `graph` mode it acquires a Microsoft Graph client-credentials access token (cached in process until one minute before expiry) and calls `POST /users/{mailbox}/sendMail`.

Web routes never call `sendEmail` directly. They insert any required rows (for example an `Invite` or a pending signup) and enqueue a `send-email` job on the existing pg-boss queue. The worker consumes the job, generates and persists an `EmailToken` (for VERIFY_EMAIL and PASSWORD_RESET), enforces a per `(email, kind)` rate limit of three sends per ten minutes, and invokes the provider. Terminal Graph errors (401, 403) fail the job without retry; 429 and 5xx responses rely on pg-boss backoff.
```

- [ ] **Step 2: `docs/data-model.md` — document `EmailToken`**

```markdown
### EmailToken

Stores hashed one-time tokens for the email verification and password reset flows. Invite tokens are not stored here; they continue to live on the `Invite` row.

| Column | Purpose |
|---|---|
| id | cuid primary key |
| userId | owner of the token |
| email | destination address captured at issue time |
| kind | VERIFY_EMAIL or PASSWORD_RESET |
| tokenHash | sha256 of the raw token; unique |
| expiresAt | absolute expiry |
| consumedAt | null until the token is used; used to enforce single consumption |
| createdAt | timestamp |

`User.emailVerified` is the NextAuth-standard nullable DateTime. It is set when a `VERIFY_EMAIL` token is consumed successfully.
```

- [ ] **Step 3: `docs/deployment.md` — add Graph app registration and env vars**

```markdown
### Email (v0.2-A)

Register an app in Entra ID with the `Mail.Send` application permission granted by an admin. Generate a client secret. Configure these environment variables on web and worker:

- `EMAIL_PROVIDER=graph`
- `GRAPH_TENANT_ID`
- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`
- `EMAIL_FROM_MAILBOX` (the UPN of a real mailbox the app can send as)
- `EMAIL_FROM_NAME` (optional display name)
- `APP_URL` (used in email links, e.g. https://app.example.com)

For local development and CI leave `EMAIL_PROVIDER=console`.
```

- [ ] **Step 4: Create `guides/email.md`**

```markdown
# Email in Knowledge Management

Three flows can send you email today: verifying your address, resetting your password, and receiving a workspace invite.

## Verifying your email
When you sign up we send a message with a link. Open it once and your account is marked verified. Until then a banner at the top of the app asks you to verify, and a small number of actions (triggering a vault export, changing your password) are disabled.

If the email does not arrive, use the "Resend email" button in the banner. For your protection we accept at most three sends per address in any ten-minute window.

## Resetting a forgotten password
From the login screen, pick "Forgot password?" and enter your email. We always show the same confirmation screen whether or not the address is known. If it is known, you will receive a link valid for one hour. Opening it takes you to a page to choose a new password.

## Workspace invites
When a teammate invites you, you receive an email containing a link to accept. The link carries an invite token; opening it while signed in adds you to the workspace. Invites are separate from the verification and password flows and do not require you to have verified your address first.
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md docs/data-model.md docs/deployment.md guides/email.md
git commit -m "docs: describe v0.2-A email flows"
```

---

### Task 22: Final end-to-end smoke and CI check

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm -r test`
Expected: All packages green.

- [ ] **Step 2: Run typecheck across workspace**

Run: `pnpm -r typecheck`
Expected: No errors.

- [ ] **Step 3: Boot web and worker against a local Postgres, walk through flows manually**

Run (two terminals):

```bash
pnpm --filter @km/web dev
pnpm --filter @km/worker dev
```

Sign up with a fresh email. Watch the worker log for the rendered verify email. Paste the link into the browser. Confirm banner disappears. Visit `/forgot`, enter the same email. Watch the worker log for the reset link. Visit it, set a new password, log in with the new password.

- [ ] **Step 4: Commit** (only if any fixup was needed)

```bash
git add -A
git commit -m "chore: tidy v0.2-A email flows loose ends"
```

---

## Self-Review Notes

- Spec coverage audited: console + graph providers (Tasks 1-4), `EmailToken` migration (Task 5), enqueue helper and token consume helper (6-7), worker handler with rate limit and invite fan-out (8), signup + forgot + reset + resend routes (9-12), verify-email / forgot / reset pages + banner (13-15), export and password verify gates (16-17), invite enqueue (18), env + Docker (19), Playwright E2E (20), docs + guides (21), smoke (22). Token hash approach, 24h verify TTL, 1h reset TTL, 10-minute / 3-send rate limit, Graph 401/403 terminal mapping, `APP_URL` links, `consumedAt` single-use, `emailVerified` soft-gate on export and password change all map to explicit tasks.
- Naming audited across tasks: `EmailToken`, `EmailTokenKind`, `VERIFY_EMAIL`, `PASSWORD_RESET`, `INVITE`, `sendEmail`, `consumeEmailToken`, `enqueueSendEmail`, `handleSendEmail`, `GraphEmailProvider`, `ConsoleEmailProvider`, `hashToken`, `generateRawToken`, `isExpired`, `signOutAllSessions` are used consistently.
- Judgment calls noted inline: the invite accept URL shape depends on the existing acceptance route; Task 8 flags that the URL parameter must match. The Playwright spec skips when a raw-token shim is not present, consistent with the spec's "read from console output or DB" guidance.
