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

## Diagrams: vendoring drawio

The drawio editor is shipped as a static web application inside `apps/web/public/drawio/`. This directory is not committed to git directly; it is populated by running `scripts/vendor-drawio.sh` from the repo root.

The script expects the drawio source repository to be cloned at a path specified by the `DRAWIO_SRC` environment variable, defaulting to `/home/jonny/drawio`. It copies the compiled webapp files into `apps/web/public/drawio/` and writes the commit SHA of the copied revision to `apps/web/public/drawio/VERSION` for traceability.

To update to a newer version of drawio, pull the latest commits in the drawio source repository and run the script again. The new files replace the old ones. No environment variables are required in the production deployment for drawio; the files are served as ordinary static assets by Next.js.

No new environment variables are required by the diagrams feature.

## Realtime service

Deploy `apps/realtime` using `infra/docker/Dockerfile.realtime`. Expose port 3001 internally; front it behind the same Cloudflare-proxied hostname as the web app under a `/yjs` path.

Environment variables the realtime service needs:

- DATABASE_URL (shared with web and worker)
- REALTIME_JWT_SECRET (distinct from NEXTAUTH_SECRET)
- REALTIME_PORT (defaults to 3001)

The web service also needs `REALTIME_JWT_SECRET` and `NEXT_PUBLIC_REALTIME_URL`.

Cloudflare: ensure WebSockets are enabled for the zone (Network settings), otherwise the upgrade request will be rejected and the browser will retry indefinitely.

## AI integration

Required on the web service:

- `ANTHROPIC_API_KEY` - server-only.
- `AI_MODEL` - default `claude-opus-4-6`.
- `AI_DAILY_TOKEN_LIMIT` - default `200000`.
- `AI_DAILY_REQUEST_LIMIT` - default `200`.
- `AI_MAX_TOOL_HOPS` - default `8`.
- `AI_PROVIDER` - leave unset in production. Set to `stub` in CI.
