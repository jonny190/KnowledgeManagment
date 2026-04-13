# Deployment

The detailed operator runbook lives at `infra/coolify/README.md`. This page summarises the pieces.

- Two container images built from `infra/docker/Dockerfile.web` and `infra/docker/Dockerfile.worker`.
- Postgres provided by Coolify as a managed service in the same compose project.
- Shared Docker named volume mounted at `/data` in both web and worker, used for attachments and export archives.
- Services are exposed over HTTP inside Coolify. Cloudflare provides HTTPS via its proxy.
- CI runs on every pull request: lint, typecheck, unit, and integration tests.
- Playwright E2E runs on pushes to main.
- Semver tags (`v0.1.0` style) trigger the release workflow which publishes the web and worker images to GitHub Container Registry.

Environment variables the runtime requires: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `DATA_DIR=/data`. See `infra/coolify/env.example` for the canonical template.
