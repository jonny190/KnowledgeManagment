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

NextAuth uses the Prisma adapter for account and user storage, with JWT session strategy (a NextAuth v4 requirement when the Credentials provider is enabled). Three providers are configured: Credentials (email plus bcrypt password hash), Google OAuth, and GitHub OAuth. The Credentials provider looks up the user by email and calls `bcrypt.compare`. OAuth first-time sign-in uses the `createUser` event to provision a personal vault and root folder, so any entry point produces the same starting state.

## Testing

Vitest covers unit and integration tests that hit a real Postgres database. Playwright covers browser-level end-to-end flows. Tests reset the database before each run so they are independent.
