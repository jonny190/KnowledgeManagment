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
