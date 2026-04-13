# Plan A: Scaffolding and Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, database, and authentication so a signed-in user exists with a personal Vault and root Folder, ready for feature plans B through D to build on.

**Architecture:** pnpm workspaces plus Turborepo drive a Next.js App Router web app, a minimal worker stub, a Prisma-backed `db` package, and a `shared` package for zod schemas. NextAuth (Auth.js) with a Prisma adapter and database sessions provides Credentials (bcrypt), Google, and GitHub login. A single signup transaction creates the User, personal Vault, and root Folder.

**Tech Stack:** Node 20, pnpm 9, Turborepo, TypeScript 5, Next.js 14 (App Router), Prisma 5, PostgreSQL 16, NextAuth 4 (Auth.js), bcryptjs, zod, Vitest, Playwright, ESLint, Prettier, Docker Compose.

---

## File Structure

Top-level layout created by this plan (files marked with star are created in this plan, others are placeholders for later plans):

```
KnowledgeManagment/
  package.json                        root workspace manifest (star)
  pnpm-workspace.yaml                 (star)
  turbo.json                          (star)
  tsconfig.base.json                  (star)
  .eslintrc.cjs                       (star)
  .prettierrc.json                    (star)
  .gitignore                          (star)
  .env.example                        (star)
  docker-compose.yml                  (star)
  README.md                           (star)
  apps/
    web/                              Next.js app (star)
      package.json
      tsconfig.json
      next.config.mjs
      .env.local.example
      src/
        app/
          layout.tsx
          page.tsx
          (auth)/login/page.tsx
          (auth)/signup/page.tsx
          (auth)/logout/page.tsx
          api/auth/[...nextauth]/route.ts
          api/signup/route.ts
        lib/auth.ts                   NextAuth config
        lib/signup.ts                 transactional signup helper
        lib/session.ts                server-side session helper
        components/auth-form.tsx
      tests/
        unit/signup.test.ts
      playwright/
        auth.spec.ts
      playwright.config.ts
      vitest.config.ts
    worker/                           Node TS stub (star)
      package.json
      tsconfig.json
      src/index.ts
  packages/
    db/                               Prisma package (star)
      package.json
      tsconfig.json
      prisma/schema.prisma
      src/index.ts
    shared/                           shared types + zod (star)
      package.json
      tsconfig.json
      src/index.ts
      src/schemas/auth.ts
  infra/
    docker/                           (placeholder dir, Plan D)
    coolify/                          (placeholder dir, Plan D)
  docs/
    architecture.md                   (star) overview
    data-model.md                     (star) schema reference
  guides/
    getting-started.md                (star) user guide
```

Each package owns one responsibility: `db` owns Prisma; `shared` owns cross-cutting zod schemas and types; `apps/web` owns the UI and API; `apps/worker` owns background jobs (stub only in this plan).

---

## Task 1: Repo bootstrap and tooling

**Files:**
- Create: `/home/jonny/KnowledgeManagment/package.json`
- Create: `/home/jonny/KnowledgeManagment/pnpm-workspace.yaml`
- Create: `/home/jonny/KnowledgeManagment/turbo.json`
- Create: `/home/jonny/KnowledgeManagment/tsconfig.base.json`
- Create: `/home/jonny/KnowledgeManagment/.eslintrc.cjs`
- Create: `/home/jonny/KnowledgeManagment/.prettierrc.json`
- Create: `/home/jonny/KnowledgeManagment/.gitignore`
- Create: `/home/jonny/KnowledgeManagment/.env.example`
- Create: `/home/jonny/KnowledgeManagment/.nvmrc`

- [ ] **Step 1: Verify prerequisites**

Run:
```bash
node -v
pnpm -v
docker --version
```
Expected: Node v20.x.x, pnpm 9.x, Docker 24+ present. If pnpm is missing run `npm i -g pnpm@9`.

- [ ] **Step 2: Create root package.json**

Write `/home/jonny/KnowledgeManagment/package.json`:
```json
{
  "name": "knowledge-management",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.3",
  "engines": { "node": ">=20.10.0" },
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:e2e": "turbo run test:e2e",
    "db:generate": "pnpm --filter @km/db generate",
    "db:migrate": "pnpm --filter @km/db migrate",
    "db:studio": "pnpm --filter @km/db studio",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@types/node": "20.12.12",
    "eslint": "8.57.0",
    "eslint-config-next": "14.2.15",
    "eslint-config-prettier": "9.1.0",
    "prettier": "3.3.3",
    "turbo": "2.1.3",
    "typescript": "5.5.4"
  }
}
```

- [ ] **Step 3: Create pnpm workspace file**

Write `/home/jonny/KnowledgeManagment/pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 4: Create turbo config**

Write `/home/jonny/KnowledgeManagment/turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": [
    "DATABASE_URL",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "DATA_DIR",
    "NODE_ENV"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "test:e2e": {
      "dependsOn": ["^build"],
      "cache": false,
      "outputs": []
    }
  }
}
```

- [ ] **Step 5: Create base tsconfig**

Write `/home/jonny/KnowledgeManagment/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "incremental": true
  }
}
```

- [ ] **Step 6: Create ESLint config**

Write `/home/jonny/KnowledgeManagment/.eslintrc.cjs`:
```js
module.exports = {
  root: true,
  extends: ["eslint:recommended", "prettier"],
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  env: { node: true, es2022: true },
  ignorePatterns: [
    "node_modules",
    "dist",
    ".next",
    ".turbo",
    "coverage",
    "playwright-report",
    "test-results",
    "packages/db/src/generated"
  ]
};
```

- [ ] **Step 7: Create Prettier config**

Write `/home/jonny/KnowledgeManagment/.prettierrc.json`:
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

- [ ] **Step 8: Create .gitignore**

Write `/home/jonny/KnowledgeManagment/.gitignore`:
```
node_modules
.next
.turbo
dist
coverage
playwright-report
test-results
.env
.env.local
.env.*.local
*.log
.DS_Store
packages/db/src/generated
```

- [ ] **Step 9: Create .env.example**

Write `/home/jonny/KnowledgeManagment/.env.example`:
```
DATABASE_URL=postgresql://km:km@localhost:5432/km?schema=public
NEXTAUTH_SECRET=replace-with-openssl-rand-base64-32
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
DATA_DIR=./.data
NODE_ENV=development
```

- [ ] **Step 10: Create .nvmrc**

Write `/home/jonny/KnowledgeManagment/.nvmrc`:
```
20.10.0
```

- [ ] **Step 11: Install root dependencies**

Run: `cd /home/jonny/KnowledgeManagment && pnpm install`
Expected: pnpm creates `node_modules` and `pnpm-lock.yaml` at repo root. No workspace packages yet, so only root devDependencies resolve.

- [ ] **Step 12: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .eslintrc.cjs .prettierrc.json .gitignore .env.example .nvmrc pnpm-lock.yaml
git commit -m "chore: initialise pnpm workspace and turborepo tooling"
```

---

## Task 2: Docker Compose for local Postgres

**Files:**
- Create: `/home/jonny/KnowledgeManagment/docker-compose.yml`

- [ ] **Step 1: Write docker-compose.yml**

Write `/home/jonny/KnowledgeManagment/docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: km-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: km
      POSTGRES_PASSWORD: km
      POSTGRES_DB: km
    ports:
      - "5432:5432"
    volumes:
      - km-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U km -d km"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  km-postgres-data:
```

- [ ] **Step 2: Start Postgres**

Run: `cd /home/jonny/KnowledgeManagment && docker compose up -d postgres`
Expected: `Container km-postgres Started` and `docker compose ps` shows `healthy` within 15 seconds.

- [ ] **Step 3: Verify connection**

Run: `docker exec -it km-postgres psql -U km -d km -c "select version();"`
Expected: Output contains `PostgreSQL 16`.

- [ ] **Step 4: Copy env file**

Run: `cd /home/jonny/KnowledgeManagment && cp .env.example .env`
Then edit `.env` so `NEXTAUTH_SECRET` has a real value:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Paste the output into `.env` replacing `replace-with-openssl-rand-base64-32`.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add docker-compose.yml
git commit -m "chore: add docker compose postgres service for local dev"
```

---

## Task 3: Shared package (zod base)

**Files:**
- Create: `/home/jonny/KnowledgeManagment/packages/shared/package.json`
- Create: `/home/jonny/KnowledgeManagment/packages/shared/tsconfig.json`
- Create: `/home/jonny/KnowledgeManagment/packages/shared/src/index.ts`
- Create: `/home/jonny/KnowledgeManagment/packages/shared/src/schemas/auth.ts`

- [ ] **Step 1: Create package.json**

Write `/home/jonny/KnowledgeManagment/packages/shared/package.json`:
```json
{
  "name": "@km/shared",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "lint": "eslint src --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "3.23.8"
  },
  "devDependencies": {
    "typescript": "5.5.4",
    "vitest": "2.1.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Write `/home/jonny/KnowledgeManagment/packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create src/index.ts**

Write `/home/jonny/KnowledgeManagment/packages/shared/src/index.ts`:
```ts
export * from "./schemas/auth";
```

- [ ] **Step 4: Create src/schemas/auth.ts**

Write `/home/jonny/KnowledgeManagment/packages/shared/src/schemas/auth.ts`:
```ts
import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
```

- [ ] **Step 5: Install workspace deps**

Run: `cd /home/jonny/KnowledgeManagment && pnpm install`
Expected: pnpm reports `@km/shared` added to the workspace and installs `zod`, `vitest`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @km/shared typecheck`
Expected: exits 0, no output.

- [ ] **Step 7: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add shared zod schemas package"
```

---

## Task 4: Prisma package with full schema

**Files:**
- Create: `/home/jonny/KnowledgeManagment/packages/db/package.json`
- Create: `/home/jonny/KnowledgeManagment/packages/db/tsconfig.json`
- Create: `/home/jonny/KnowledgeManagment/packages/db/prisma/schema.prisma`
- Create: `/home/jonny/KnowledgeManagment/packages/db/src/index.ts`

- [ ] **Step 1: Create package.json**

Write `/home/jonny/KnowledgeManagment/packages/db/package.json`:
```json
{
  "name": "@km/db",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "prisma generate",
    "migrate": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "studio": "prisma studio",
    "lint": "eslint src --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@prisma/client": "5.20.0"
  },
  "devDependencies": {
    "prisma": "5.20.0",
    "typescript": "5.5.4",
    "vitest": "2.1.2"
  },
  "prisma": {
    "schema": "prisma/schema.prisma"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Write `/home/jonny/KnowledgeManagment/packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create Prisma schema**

Write `/home/jonny/KnowledgeManagment/packages/db/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  emailVerified DateTime?
  passwordHash  String?
  name          String?
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts    Account[]
  sessions    Session[]
  memberships Membership[]
  ownedWorkspaces Workspace[] @relation("WorkspaceOwner")
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

enum VaultOwnerType {
  USER
  WORKSPACE
}

enum MembershipRole {
  OWNER
  ADMIN
  MEMBER
}

model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  ownerId   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  owner       User         @relation("WorkspaceOwner", fields: [ownerId], references: [id])
  memberships Membership[]
  invites     Invite[]

  @@index([ownerId])
}

model Membership {
  id          String         @id @default(cuid())
  workspaceId String
  userId      String
  role        MembershipRole
  createdAt   DateTime       @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId])
}

model Invite {
  id          String         @id @default(cuid())
  workspaceId String
  email       String
  token       String         @unique
  role        MembershipRole
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime       @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@index([email])
}

model Vault {
  id        String         @id @default(cuid())
  ownerType VaultOwnerType
  ownerId   String
  name      String
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  folders     Folder[]
  notes       Note[]
  attachments Attachment[]
  exportJobs  ExportJob[]

  @@index([ownerType, ownerId])
}

model Folder {
  id       String  @id @default(cuid())
  vaultId  String
  parentId String?
  name     String
  path     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  vault    Vault    @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  parent   Folder?  @relation("FolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children Folder[] @relation("FolderTree")
  notes       Note[]
  attachments Attachment[]

  @@index([vaultId])
  @@index([parentId])
}

model Note {
  id               String   @id @default(cuid())
  vaultId          String
  folderId         String?
  title            String
  slug             String
  content          String   @db.Text
  contentUpdatedAt DateTime @default(now())
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  createdById      String
  updatedById      String

  vault  Vault   @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  folder Folder? @relation(fields: [folderId], references: [id], onDelete: SetNull)

  outgoingLinks Link[] @relation("SourceNote")
  incomingLinks Link[] @relation("TargetNote")

  @@unique([vaultId, slug])
  @@index([vaultId])
  @@index([folderId])
}

model Attachment {
  id           String   @id @default(cuid())
  vaultId      String
  folderId     String?
  filename     String
  mimeType     String
  size         Int
  storagePath  String
  uploadedById String
  createdAt    DateTime @default(now())

  vault  Vault   @relation(fields: [vaultId], references: [id], onDelete: Cascade)
  folder Folder? @relation(fields: [folderId], references: [id], onDelete: SetNull)

  @@index([vaultId])
}

model Link {
  id           String  @id @default(cuid())
  sourceNoteId String
  targetNoteId String?
  targetTitle  String
  resolved     Boolean @default(false)
  createdAt    DateTime @default(now())

  sourceNote Note  @relation("SourceNote", fields: [sourceNoteId], references: [id], onDelete: Cascade)
  targetNote Note? @relation("TargetNote", fields: [targetNoteId], references: [id], onDelete: SetNull)

  @@index([sourceNoteId])
  @@index([targetNoteId])
}

enum ExportStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}

model ExportJob {
  id          String       @id @default(cuid())
  vaultId     String
  status      ExportStatus @default(PENDING)
  startedAt   DateTime?
  finishedAt  DateTime?
  archivePath String?
  error       String?
  createdAt   DateTime     @default(now())

  vault Vault @relation(fields: [vaultId], references: [id], onDelete: Cascade)

  @@index([vaultId])
  @@index([status])
}
```

- [ ] **Step 4: Create Prisma client re-export**

Write `/home/jonny/KnowledgeManagment/packages/db/src/index.ts`:
```ts
import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __km_prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__km_prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__km_prisma = prisma;
}

export * from "@prisma/client";
```

- [ ] **Step 5: Install dependencies**

Run: `cd /home/jonny/KnowledgeManagment && pnpm install`
Expected: pnpm installs `@prisma/client`, `prisma`.

- [ ] **Step 6: Generate client and run initial migration**

Ensure Postgres is running (`docker compose up -d postgres`), then:
```bash
cd /home/jonny/KnowledgeManagment
export $(grep -v '^#' .env | xargs)
pnpm --filter @km/db exec prisma migrate dev --name init
```
Expected: Prisma creates `packages/db/prisma/migrations/YYYYMMDDHHMMSS_init/migration.sql`, applies it, and generates the client. Output ends with `Your database is now in sync with your schema.`

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @km/db typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): add prisma schema with auth, workspace, vault, note, link, export models"
```

---

## Task 5: Worker stub

**Files:**
- Create: `/home/jonny/KnowledgeManagment/apps/worker/package.json`
- Create: `/home/jonny/KnowledgeManagment/apps/worker/tsconfig.json`
- Create: `/home/jonny/KnowledgeManagment/apps/worker/src/index.ts`

- [ ] **Step 1: Create package.json**

Write `/home/jonny/KnowledgeManagment/apps/worker/package.json`:
```json
{
  "name": "@km/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "lint": "eslint src --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@km/db": "workspace:*",
    "@km/shared": "workspace:*"
  },
  "devDependencies": {
    "tsx": "4.19.1",
    "typescript": "5.5.4",
    "vitest": "2.1.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Write `/home/jonny/KnowledgeManagment/apps/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "types": ["node"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create src/index.ts**

Write `/home/jonny/KnowledgeManagment/apps/worker/src/index.ts`:
```ts
function main(): void {
  // eslint-disable-next-line no-console
  console.log("worker started");
}

main();
```

- [ ] **Step 4: Install deps**

Run: `cd /home/jonny/KnowledgeManagment && pnpm install`
Expected: `@km/worker` linked into workspace with `tsx`.

- [ ] **Step 5: Verify it runs**

Run: `pnpm --filter @km/worker dev`
Expected: `worker started` printed within 2 seconds. Ctrl-C to stop.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @km/worker typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add apps/worker pnpm-lock.yaml
git commit -m "feat(worker): add minimal node ts worker stub"
```

---

## Task 6: Next.js web app scaffold

**Files:**
- Create: `/home/jonny/KnowledgeManagment/apps/web/package.json`
- Create: `/home/jonny/KnowledgeManagment/apps/web/tsconfig.json`
- Create: `/home/jonny/KnowledgeManagment/apps/web/next.config.mjs`
- Create: `/home/jonny/KnowledgeManagment/apps/web/next-env.d.ts`
- Create: `/home/jonny/KnowledgeManagment/apps/web/.env.local.example`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/layout.tsx`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/page.tsx`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/globals.css`

- [ ] **Step 1: Create package.json**

Write `/home/jonny/KnowledgeManagment/apps/web/package.json`:
```json
{
  "name": "@km/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "lint": "next lint --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@km/db": "workspace:*",
    "@km/shared": "workspace:*",
    "@auth/prisma-adapter": "2.7.2",
    "@prisma/client": "5.20.0",
    "bcryptjs": "2.4.3",
    "next": "14.2.15",
    "next-auth": "4.24.10",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@playwright/test": "1.47.2",
    "@types/bcryptjs": "2.4.6",
    "@types/react": "18.3.11",
    "@types/react-dom": "18.3.0",
    "eslint-config-next": "14.2.15",
    "typescript": "5.5.4",
    "vitest": "2.1.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Write `/home/jonny/KnowledgeManagment/apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": false,
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "playwright", "tests"]
}
```

- [ ] **Step 3: Create next.config.mjs**

Write `/home/jonny/KnowledgeManagment/apps/web/next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@km/db", "@km/shared"],
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create next-env.d.ts**

Write `/home/jonny/KnowledgeManagment/apps/web/next-env.d.ts`:
```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 5: Create .env.local.example**

Write `/home/jonny/KnowledgeManagment/apps/web/.env.local.example`:
```
DATABASE_URL=postgresql://km:km@localhost:5432/km?schema=public
NEXTAUTH_SECRET=replace-me
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

- [ ] **Step 6: Create root layout**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/layout.tsx`:
```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Knowledge Management",
  description: "Web-based knowledge management platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Create home page**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/page.tsx`:
```tsx
import Link from "next/link";
import { getServerAuthSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getServerAuthSession();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Knowledge Management</h1>
      {session ? (
        <p>
          Signed in as {session.user?.email}. <Link href="/logout">Log out</Link>
        </p>
      ) : (
        <p>
          <Link href="/login">Log in</Link> or <Link href="/signup">Sign up</Link>
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 8: Create globals.css**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/globals.css`:
```css
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; }
a { color: #2563eb; }
```

- [ ] **Step 9: Install deps**

Run: `cd /home/jonny/KnowledgeManagment && pnpm install`
Expected: installs Next.js, NextAuth, Prisma adapter, bcryptjs, Playwright.

- [ ] **Step 10: Install Playwright browsers**

Run: `pnpm --filter @km/web exec playwright install --with-deps chromium`
Expected: Playwright downloads Chromium. Note: Do not fail the plan if `--with-deps` fails on WSL; re-run without `--with-deps` as a fallback.

- [ ] **Step 11: Commit (web will not typecheck yet, that is fine; auth files follow next tasks)**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold next.js app router shell"
```

---

## Task 7: NextAuth configuration

**Files:**
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/lib/auth.ts`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/lib/session.ts`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Create lib/auth.ts**

Write `/home/jonny/KnowledgeManagment/apps/web/src/lib/auth.ts`:
```ts
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { prisma } from "@km/db";
import { loginSchema } from "@km/shared";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  secret: requireEnv("NEXTAUTH_SECRET"),
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
        if (!user || !user.passwordHash) return null;
        const ok = await compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        (session.user as { id?: string }).id = user.id;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      // OAuth first-time sign-in: ensure a personal vault + root folder exist.
      await prisma.$transaction(async (tx) => {
        const existing = await tx.vault.findFirst({
          where: { ownerType: "USER", ownerId: user.id },
        });
        if (existing) return;
        const vault = await tx.vault.create({
          data: { ownerType: "USER", ownerId: user.id, name: "Personal" },
        });
        await tx.folder.create({
          data: { vaultId: vault.id, name: "", path: "" },
        });
      });
    },
  },
};
```

- [ ] **Step 2: Create lib/session.ts**

Write `/home/jonny/KnowledgeManagment/apps/web/src/lib/session.ts`:
```ts
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export function getServerAuthSession() {
  return getServerSession(authOptions);
}
```

- [ ] **Step 3: Create NextAuth route handler**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/api/auth/[...nextauth]/route.ts`:
```ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add apps/web/src/lib/auth.ts apps/web/src/lib/session.ts apps/web/src/app/api/auth
git commit -m "feat(web): wire next-auth with credentials, google, github and prisma adapter"
```

---

## Task 8: Signup helper with TDD (transaction creates User + Vault + Folder)

**Files:**
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/lib/signup.ts`
- Create: `/home/jonny/KnowledgeManagment/apps/web/tests/unit/signup.test.ts`
- Create: `/home/jonny/KnowledgeManagment/apps/web/vitest.config.ts`
- Create: `/home/jonny/KnowledgeManagment/apps/web/tests/setup/reset-db.ts`

- [ ] **Step 1: Create vitest config**

Write `/home/jonny/KnowledgeManagment/apps/web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 20000,
    setupFiles: ["./tests/setup/reset-db.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2: Create DB reset helper**

Write `/home/jonny/KnowledgeManagment/apps/web/tests/setup/reset-db.ts`:
```ts
import { prisma } from "@km/db";
import { beforeEach, afterAll } from "vitest";

beforeEach(async () => {
  // Truncate in dependency order.
  await prisma.link.deleteMany();
  await prisma.note.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.exportJob.deleteMany();
  await prisma.vault.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

- [ ] **Step 3: Write the failing test**

Write `/home/jonny/KnowledgeManagment/apps/web/tests/unit/signup.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { compare } from "bcryptjs";
import { prisma } from "@km/db";
import { signupWithCredentials } from "@/lib/signup";

describe("signupWithCredentials", () => {
  it("creates a user, personal vault, and root folder atomically", async () => {
    const result = await signupWithCredentials({
      email: "alice@example.com",
      password: "correct horse battery",
      name: "Alice",
    });

    expect(result.user.email).toBe("alice@example.com");
    expect(result.user.passwordHash).not.toBeNull();
    expect(await compare("correct horse battery", result.user.passwordHash!)).toBe(true);

    expect(result.vault.ownerType).toBe("USER");
    expect(result.vault.ownerId).toBe(result.user.id);

    expect(result.rootFolder.vaultId).toBe(result.vault.id);
    expect(result.rootFolder.parentId).toBeNull();

    const foldersInDb = await prisma.folder.findMany({ where: { vaultId: result.vault.id } });
    expect(foldersInDb).toHaveLength(1);
  });

  it("rejects duplicate email", async () => {
    await signupWithCredentials({
      email: "bob@example.com",
      password: "password123",
    });
    await expect(
      signupWithCredentials({ email: "bob@example.com", password: "password123" }),
    ).rejects.toThrow(/already/i);
  });

  it("validates the email and password with zod", async () => {
    await expect(
      signupWithCredentials({ email: "not-an-email", password: "password123" }),
    ).rejects.toThrow();
    await expect(
      signupWithCredentials({ email: "ok@example.com", password: "short" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `pnpm --filter @km/web test`
Expected: FAIL with `Cannot find module '@/lib/signup'` or similar.

- [ ] **Step 5: Implement signupWithCredentials**

Write `/home/jonny/KnowledgeManagment/apps/web/src/lib/signup.ts`:
```ts
import { hash } from "bcryptjs";
import { prisma, type User, type Vault, type Folder } from "@km/db";
import { signupSchema, type SignupInput } from "@km/shared";

export interface SignupResult {
  user: User;
  vault: Vault;
  rootFolder: Folder;
}

export async function signupWithCredentials(input: SignupInput): Promise<SignupResult> {
  const parsed = signupSchema.parse(input);

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) {
    throw new Error("An account with that email already exists");
  }

  const passwordHash = await hash(parsed.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: parsed.email,
        passwordHash,
        name: parsed.name,
      },
    });
    const vault = await tx.vault.create({
      data: {
        ownerType: "USER",
        ownerId: user.id,
        name: "Personal",
      },
    });
    const rootFolder = await tx.folder.create({
      data: {
        vaultId: vault.id,
        name: "",
        path: "",
      },
    });
    return { user, vault, rootFolder };
  });
}
```

- [ ] **Step 6: Ensure .env is loaded for tests**

Append to `/home/jonny/KnowledgeManagment/apps/web/package.json` scripts block so `test` loads env. Replace the `"test"` line in the scripts block with:
```json
"test": "dotenv -e ../../.env -- vitest run",
```
Then add dev dep `dotenv-cli`:
```bash
cd /home/jonny/KnowledgeManagment
pnpm --filter @km/web add -D dotenv-cli@7.4.2
```

- [ ] **Step 7: Run tests and verify they pass**

Run: `pnpm --filter @km/web test`
Expected: three tests pass. Output includes `3 passed`.

- [ ] **Step 8: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add apps/web/src/lib/signup.ts apps/web/tests apps/web/vitest.config.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add transactional credentials signup with tests"
```

---

## Task 9: Signup API route

**Files:**
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/api/signup/route.ts`

- [ ] **Step 1: Create the route**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/api/signup/route.ts`:
```ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { signupSchema } from "@km/shared";
import { signupWithCredentials } from "@/lib/signup";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const parsed = signupSchema.parse(body);
    const { user } = await signupWithCredentials(parsed);
    return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = /already/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add apps/web/src/app/api/signup
git commit -m "feat(web): add POST /api/signup route"
```

---

## Task 10: Auth UI pages (login, signup, logout)

**Files:**
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/components/auth-form.tsx`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/(auth)/signup/page.tsx`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/(auth)/login/page.tsx`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/(auth)/logout/page.tsx`
- Create: `/home/jonny/KnowledgeManagment/apps/web/src/app/providers.tsx`
- Modify: `/home/jonny/KnowledgeManagment/apps/web/src/app/layout.tsx`

- [ ] **Step 1: Create SessionProvider wrapper**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/providers.tsx`:
```tsx
"use client";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

- [ ] **Step 2: Wrap layout in Providers**

Replace `/home/jonny/KnowledgeManagment/apps/web/src/app/layout.tsx` with:
```tsx
import "./globals.css";
import type { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = {
  title: "Knowledge Management",
  description: "Web-based knowledge management platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create the shared auth form component**

Write `/home/jonny/KnowledgeManagment/apps/web/src/components/auth-form.tsx`:
```tsx
"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name: name || undefined }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Signup failed");
        }
      }
      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (!signInResult || signInResult.error) {
        throw new Error(signInResult?.error ?? "Sign in failed");
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 360 }}>
      {mode === "signup" && (
        <label>
          Name
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </label>
      )}
      <label>
        Email
        <input
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : 1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
      </label>
      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Working..." : mode === "signup" ? "Sign up" : "Log in"}
      </button>
      <hr />
      <button type="button" onClick={() => signIn("google", { callbackUrl: "/" })}>
        Continue with Google
      </button>
      <button type="button" onClick={() => signIn("github", { callbackUrl: "/" })}>
        Continue with GitHub
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Create signup page**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/(auth)/signup/page.tsx`:
```tsx
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function SignupPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Create an account</h1>
      <AuthForm mode="signup" />
      <p>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Create login page**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/(auth)/login/page.tsx`:
```tsx
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Log in</h1>
      <AuthForm mode="login" />
      <p>
        No account yet? <Link href="/signup">Sign up</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Create logout page**

Write `/home/jonny/KnowledgeManagment/apps/web/src/app/(auth)/logout/page.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { signOut } from "next-auth/react";

export default function LogoutPage() {
  useEffect(() => {
    signOut({ callbackUrl: "/" });
  }, []);
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <p>Logging out...</p>
    </main>
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @km/web typecheck`
Expected: exits 0.

- [ ] **Step 8: Manual smoke test**

Run, in separate terminals:
```bash
cd /home/jonny/KnowledgeManagment && docker compose up -d postgres
cd /home/jonny/KnowledgeManagment && pnpm --filter @km/web dev
```
Open http://localhost:3000/signup, create an account with `test@example.com` / `password123`. You should land on `/` showing "Signed in as test@example.com". Then `docker exec -it km-postgres psql -U km -d km -c "select email from \"User\"; select \"ownerType\", name from \"Vault\"; select name, path from \"Folder\";"` should show one User, one Vault (USER / Personal), and one Folder.

- [ ] **Step 9: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add apps/web/src
git commit -m "feat(web): add signup, login, logout pages with credentials and oauth buttons"
```

---

## Task 11: Playwright E2E for signup and logout

**Files:**
- Create: `/home/jonny/KnowledgeManagment/apps/web/playwright.config.ts`
- Create: `/home/jonny/KnowledgeManagment/apps/web/playwright/auth.spec.ts`
- Create: `/home/jonny/KnowledgeManagment/apps/web/playwright/global-setup.ts`

- [ ] **Step 1: Create playwright.config.ts**

Write `/home/jonny/KnowledgeManagment/apps/web/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  globalSetup: "./playwright/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
```

- [ ] **Step 2: Create global-setup.ts**

Write `/home/jonny/KnowledgeManagment/apps/web/playwright/global-setup.ts`:
```ts
import { PrismaClient } from "@prisma/client";

export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.link.deleteMany();
    await prisma.note.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.exportJob.deleteMany();
    await prisma.vault.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.user.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
}
```

- [ ] **Step 3: Write the failing E2E spec**

Write `/home/jonny/KnowledgeManagment/apps/web/playwright/auth.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

const EMAIL = `e2e-${Date.now()}@example.com`;
const PASSWORD = "password123";

test("signup, logout, login round trip", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible();

  await page.getByRole("link", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();

  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible();
});
```

- [ ] **Step 4: Run the E2E test**

Ensure Postgres is up: `docker compose up -d postgres`.
Run:
```bash
cd /home/jonny/KnowledgeManagment
pnpm --filter @km/web exec dotenv -e ../../.env -- playwright test
```
Expected: `1 passed`. The Playwright web server config will start Next.js on 3000.

- [ ] **Step 5: Adjust test:e2e script to load env**

Replace the `"test:e2e"` script in `/home/jonny/KnowledgeManagment/apps/web/package.json` with:
```json
"test:e2e": "dotenv -e ../../.env -- playwright test",
```

- [ ] **Step 6: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add apps/web/playwright.config.ts apps/web/playwright apps/web/package.json
git commit -m "test(web): add playwright e2e for signup, logout, login"
```

---

## Task 12: Docs, guide, README

**Files:**
- Create: `/home/jonny/KnowledgeManagment/README.md`
- Create: `/home/jonny/KnowledgeManagment/docs/architecture.md`
- Create: `/home/jonny/KnowledgeManagment/docs/data-model.md`
- Create: `/home/jonny/KnowledgeManagment/guides/getting-started.md`

- [ ] **Step 1: Write README.md**

Write `/home/jonny/KnowledgeManagment/README.md`:
```markdown
# Knowledge Management

Web-based, multi-user knowledge management platform. This repository holds the Foundation sub-project: monorepo scaffolding, database, authentication, and an empty personal vault per user. Later phases add collaborative editing, AI, diagrams, and polish.

## Requirements

- Node 20.10 or newer
- pnpm 9
- Docker (for local Postgres)

## First-time setup

1. Install dependencies.
   ```
   pnpm install
   ```
2. Start Postgres.
   ```
   docker compose up -d postgres
   ```
3. Copy environment variables and set a real `NEXTAUTH_SECRET`.
   ```
   cp .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Paste the output into `NEXTAUTH_SECRET` in `.env`.
4. Run the initial migration.
   ```
   pnpm db:migrate
   ```
5. Start the dev servers.
   ```
   pnpm dev
   ```
   The web app is at http://localhost:3000.

## Scripts

- `pnpm dev` runs every workspace app in parallel via Turborepo.
- `pnpm build` builds every app.
- `pnpm typecheck` runs `tsc --noEmit` across the workspace.
- `pnpm lint` runs ESLint across the workspace.
- `pnpm test` runs Vitest suites.
- `pnpm test:e2e` runs Playwright end-to-end tests.
- `pnpm db:migrate`, `pnpm db:generate`, `pnpm db:studio` wrap Prisma.

## Packages

- `apps/web`, Next.js App Router UI and API.
- `apps/worker`, Node service for background jobs (stub in this phase).
- `packages/db`, Prisma schema and client.
- `packages/shared`, shared zod schemas and TypeScript types.

## Documentation

- `docs/architecture.md`, technical overview.
- `docs/data-model.md`, database reference.
- `guides/getting-started.md`, end-user guide.
```

- [ ] **Step 2: Write docs/architecture.md**

Write `/home/jonny/KnowledgeManagment/docs/architecture.md`:
```markdown
# Architecture Overview

This document describes the Foundation phase. Later phases extend it without rewriting the core.

## Monorepo

pnpm workspaces and Turborepo manage the repo. Apps live under `apps/`, reusable code lives under `packages/`. Each package is a normal Node workspace with its own `package.json`, `tsconfig.json`, and scripts.

## Web app

`apps/web` is a Next.js App Router project. Server actions and route handlers live alongside the UI. NextAuth is mounted under `/api/auth/[...nextauth]`. The signup flow posts to `/api/signup`, which creates a user, a personal vault, and a root folder in a single Prisma transaction before NextAuth issues a session.

## Worker

`apps/worker` is a minimal Node TypeScript service. In this phase it only logs that it started; later phases add the pg-boss queue consumer for markdown export jobs.

## Database

PostgreSQL managed by Prisma in `packages/db`. The schema covers authentication (User, Account, Session, VerificationToken), workspaces (Workspace, Membership, Invite), content (Vault, Folder, Note, Attachment, Link), and background work (ExportJob). Models for notes, attachments, links, and export jobs are declared now so future phases add behaviour without schema churn.

## Shared code

`packages/shared` holds zod schemas and types used across the web app and the worker. The signup and login schemas live here so client and server validate the same way.

## Auth model

NextAuth uses the Prisma adapter with database sessions. Three providers are configured: Credentials (email plus bcrypt password hash), Google OAuth, and GitHub OAuth. The Credentials provider looks up the user by email and calls `bcrypt.compare`. OAuth first-time sign-in uses the `createUser` event to provision a personal vault and root folder, so any entry point produces the same starting state.

## Testing

Vitest covers unit and integration tests that hit a real Postgres database. Playwright covers browser-level end-to-end flows. Tests reset the database before each run so they are independent.
```

- [ ] **Step 3: Write docs/data-model.md**

Write `/home/jonny/KnowledgeManagment/docs/data-model.md`:
```markdown
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
```

- [ ] **Step 4: Write guides/getting-started.md**

Write `/home/jonny/KnowledgeManagment/guides/getting-started.md`:
```markdown
# Getting Started

This guide walks a new user through creating an account and signing in.

## Creating an account

1. Open the home page.
2. Choose "Sign up".
3. Enter your email and a password of at least eight characters. A display name is optional.
4. Select "Sign up".

After signup the app signs you in automatically and takes you back to the home page. You now have a personal vault, which is a private space for your notes. Content features are introduced in later phases.

You can also sign up by choosing "Continue with Google" or "Continue with GitHub". The first time you use one of those, the app creates your account and personal vault in one step.

## Logging out

Select "Log out" from the home page when you are signed in. You are returned to the home page as a signed-out visitor.

## Logging back in

1. Open the home page.
2. Choose "Log in".
3. Enter the same email and password you used at signup, or pick the OAuth provider you used originally.

## What happens next

Further phases of the product introduce notes, folders, wiki-links, backlinks, attachments, and exports. Those guides are published alongside each phase.
```

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git add README.md docs guides
git commit -m "docs: add README, architecture notes, data model reference, getting-started guide"
```

---

## Task 13: Final verification

- [ ] **Step 1: Install from a clean state to prove reproducibility**

Run:
```bash
cd /home/jonny/KnowledgeManagment
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```
Expected: install succeeds, no peer dependency errors.

- [ ] **Step 2: Generate Prisma client**

Run: `pnpm db:generate`
Expected: `Generated Prisma Client` message.

- [ ] **Step 3: Apply migrations**

Run: `pnpm --filter @km/db exec dotenv -e ../../.env -- prisma migrate deploy`
Expected: migrations applied, `No pending migrations to apply` or the initial migration applied.

- [ ] **Step 4: Run all typechecks**

Run: `pnpm typecheck`
Expected: every workspace package exits 0.

- [ ] **Step 5: Run all lint**

Run: `pnpm lint`
Expected: zero errors. If a package has no files to lint it still exits 0.

- [ ] **Step 6: Run all unit tests**

Run: `pnpm test`
Expected: Vitest reports the signup suite passing, 3 passed.

- [ ] **Step 7: Run E2E tests**

Run: `pnpm --filter @km/web test:e2e`
Expected: 1 passed (signup-logout-login round trip).

- [ ] **Step 8: Smoke-test pnpm dev**

Run: `pnpm dev`
Expected: Next.js reports `Ready on http://localhost:3000` and the worker logs `worker started`. Hit Ctrl-C to stop.

- [ ] **Step 9: Final commit if anything changed**

Run:
```bash
cd /home/jonny/KnowledgeManagment
git status
```
Expected: working tree clean. If anything was modified during verification (for example formatting), run:
```bash
git add -A
git commit -m "chore: verification pass tidy"
```

---

## Done criteria

- `pnpm install` succeeds from a clean checkout.
- `docker compose up -d postgres` plus `pnpm db:migrate` brings the database up.
- `pnpm dev` starts Next.js on port 3000 and the worker prints `worker started`.
- A user can visit `/signup`, register with email and password, and land on `/` signed in. One User row, one Vault row (ownerType USER), and one root Folder row exist for that account.
- A user can sign out via `/logout` and sign back in via `/login`.
- Google and GitHub provider buttons are present and wired; when configured with real client IDs and secrets they complete sign-in and the `createUser` event provisions the personal vault and root folder.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm --filter @km/web test:e2e` all pass.
- Docs under `docs/` and the guide under `guides/` are present and reflect what was built.
