# Coolify Deployment Runbook

This runbook covers deploying the knowledge management platform to the Coria Coolify instance at https://coolify.daveys.xyz/. Per the team's global rule, services run over HTTP inside Coolify and HTTPS is terminated by the Cloudflare proxy in front.

## Prerequisites

- Access to the Coolify dashboard with the Coria team selected.
- A Cloudflare zone that will host the public domain (for example knowledge.example.com). API access is managed outside Coolify; a DNS record pointing at the Coolify host with the proxy enabled is required.
- A GitHub repository that Coolify can pull from, with the `main` branch up to date.
- The operator exports the Coolify API token as the environment variable `COOLIFY_API_TOKEN` locally if they want to script actions. The token is never committed to the repo.

## One-time project setup

1. Sign in to https://coolify.daveys.xyz/ and pick the Coria team.
2. Create a new Project named `knowledge-management`.
3. Inside the project create an Environment named `production`.
4. Add a new Resource of type `Docker Compose`:
   - Source: the GitHub repository containing this codebase.
   - Branch: `main`.
   - Compose file path: `infra/docker/docker-compose.prod.yml`.
5. Coolify will parse the compose file and show three services: `postgres`, `web`, `worker`.

## Environment variables

Copy `infra/coolify/env.example` into the Coolify environment UI. Fill in the blank values:

- `POSTGRES_PASSWORD`: generate a long random string. Store it in your password manager.
- `NEXTAUTH_SECRET`: generate with `openssl rand -hex 32`.
- `NEXTAUTH_URL`: the public HTTPS URL of the web service (Cloudflare in front).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: from the Google Cloud console OAuth credentials. Redirect URI is `${NEXTAUTH_URL}/api/auth/callback/google`.
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: from GitHub Developer Settings. Redirect URI is `${NEXTAUTH_URL}/api/auth/callback/github`.
- `DATABASE_URL`: leave pointing at the compose-internal `postgres` hostname.
- `DATA_DIR`: leave at `/data`.
- `WEB_IMAGE` and `WORKER_IMAGE`: leave at the GHCR tags if using the release pipeline. For source builds, leave blank and Coolify will build from the Dockerfiles.

## Volumes

Coolify surfaces two named volumes from the compose file:

- `pgdata`: persists Postgres data.
- `appdata`: mounted at `/data` in both `web` and `worker`. Holds attachments under `/data/vaults/<vaultId>/attachments/` and export archives under `/data/exports/`.

Confirm both volumes are marked Persistent in the Coolify UI. Do not let Coolify re-create them between deploys.

## Domain and Cloudflare

1. In Coolify, attach a domain to the `web` service. Use the public hostname, for example `knowledge.example.com`.
2. Disable TLS termination in Coolify. The service listens on HTTP port 3000.
3. In Cloudflare, create a proxied `A` record pointing at the Coolify host's public IP.
4. Set Cloudflare SSL mode to Full (strict is not required because Coolify speaks HTTP inside the tunnel and Cloudflare treats the proxy as the TLS boundary per the team's global policy).
5. Update `NEXTAUTH_URL` to the HTTPS URL and redeploy.

## First deploy

1. Click Deploy in Coolify. It will build the images (or pull if image tags are set), run migrations as part of the `web` container start, and boot all three services.
2. Watch logs for `web` until you see `Ready on http://0.0.0.0:3000`. Watch `worker` until you see `[worker] ready`.
3. Run database migrations explicitly the first time:

   ```bash
   docker exec -it $(docker ps -qf "name=web") pnpm --filter @km/db migrate:deploy
   ```

4. Visit the public URL and register the first user. That user becomes the implicit administrator by virtue of being first.

## Updating

Tag a release in GitHub (for example `v0.1.0`). The release workflow in `.github/workflows/release.yml` builds and pushes `ghcr.io/jonny/kmgmt-web:v0.1.0` and `ghcr.io/jonny/kmgmt-worker:v0.1.0`. In Coolify set the image tags via the env vars and redeploy.

Between tagged releases, pushing to `main` triggers CI only; no images are published. Deploy from source by pointing Coolify at `main` and clicking Deploy.

## Rollback

Set `WEB_IMAGE` and `WORKER_IMAGE` to the previous tag in the Coolify env and redeploy. Postgres data is untouched. Exports produced by the newer code remain downloadable because they are plain zip files.

## Backups

Back up the `pgdata` and `appdata` volumes on a nightly schedule through Coolify's backup integration or a host-level `restic` cron. The nightly export job also writes a fresh markdown zip of every vault to `/data/exports/`, giving a secondary human-readable backup format.

## Realtime service

The `@km/realtime` app runs Hocuspocus on port 3001. Deploy it as a separate Coolify service using `infra/docker/Dockerfile.realtime`.

Required environment variables:

- DATABASE_URL (same value as web and worker)
- REALTIME_JWT_SECRET (distinct from NEXTAUTH_SECRET; generate with openssl rand -base64 32)
- REALTIME_PORT=3001

The web service additionally needs:

- REALTIME_JWT_SECRET (same value as realtime)
- NEXT_PUBLIC_REALTIME_URL (the public WebSocket URL the browser will open, e.g. wss://knowledge.example.com/yjs)

Cloudflare Proxy: the realtime route must have WebSockets enabled in the Cloudflare dashboard under Network settings. Per the project convention, the upstream between Cloudflare and Coolify is HTTP; the WebSocket upgrade travels over the same connection.

## AI integration

Phase 3 adds an in-app chat panel and inline slash commands powered by the Anthropic Claude API. No new container is required; the web service makes outbound HTTPS calls to api.anthropic.com.

Required env vars on the web service:

- `ANTHROPIC_API_KEY` - server-only secret. Never expose to the browser.
- `AI_MODEL` - default `claude-opus-4-6`. Override per environment if needed.
- `AI_DAILY_TOKEN_LIMIT` - default `200000`. Per-user, per-day combined input plus output token cap.
- `AI_DAILY_REQUEST_LIMIT` - default `200`. Per-user, per-day request cap.
- `AI_MAX_TOOL_HOPS` - default `8`. Upper bound on tool-call rounds per chat turn.

The Cloudflare proxy already supports Server-Sent Events. No proxy config changes are needed for the new endpoints (`/api/ai/chat`, `/api/ai/command`, `/api/ai/conversations`).

## Troubleshooting

- `worker` restarts in a loop: check `DATABASE_URL` reachability and that the pg-boss schema has been created. pg-boss provisions its own schema on first run; if the Postgres user lacks `CREATE` permission, grant it.
- Exports stuck at `PENDING`: confirm the `worker` container is running and not blocked by a failing handler. Inspect `pgboss.job` and `pgboss.archive` tables.
- 401 from OAuth callbacks: check `NEXTAUTH_URL` matches the exact public hostname, including protocol, no trailing slash.
