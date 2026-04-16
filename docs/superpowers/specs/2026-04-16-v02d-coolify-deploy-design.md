# v0.2-D Coolify Deployment

**Date:** 2026-04-16
**Status:** Approved, executing now
**Builds on:** v0.2.3 (mobile/responsive UI shipped)

## Context

The three Docker images (`km-web`, `km-worker`, `km-realtime`) have been pushed to GHCR on every tag release up to and including v0.2.3. The Coolify runbook in `infra/coolify/README.md` describes how an operator sets the stack up by hand. This phase performs the first real deployment against Jonny's Coolify instance via the Coolify and Cloudflare APIs, then records what was done so the runbook stays honest.

## Scope

- Deploy v0.2.3 to Coolify as the `km` project.
- Public URLs on the coria Cloudflare zone behind a Cloudflare Tunnel (`bd31aff0-a681-4daa-8deb-c125b72c5d57`).
- First-deploy posture: stub AI, console email, OAuth providers disabled. Real providers are a future operator task.

Out of scope:

- CI-driven auto-deploy on tag push.
- Backup policy (volume snapshots, Postgres dumps).
- Monitoring / alerting integration.
- Load / chaos tests.

## Routing

```
Browser
  https://km.daveys.xyz                         wss://km-ws.daveys.xyz
Cloudflare Edge (TLS termination, WS enabled)
  CNAME
<tunnel-id>.cfargotunnel.com
cloudflared on Jonny's host
  ingress:
    km.daveys.xyz    -> http://localhost:80
    km-ws.daveys.xyz -> http://localhost:80
Coolify proxy (Traefik default, port 80)
  Host-based routing:
    km.daveys.xyz    -> km-web container    :3000
    km-ws.daveys.xyz -> km-realtime container :3001
Internal container network:
  km-web, km-realtime, km-worker, km-postgres
```

## Services

| Service | Image | Public | Internal port | FQDN |
|---|---|---|---|---|
| km-postgres | `postgres:16-alpine` (Coolify managed DB) | No | 5432 | - |
| km-web | `ghcr.io/jonny190/km-web:v0.2.3` | Yes | 3000 | km.daveys.xyz |
| km-realtime | `ghcr.io/jonny190/km-realtime:v0.2.3` | Yes | 3001 | km-ws.daveys.xyz |
| km-worker | `ghcr.io/jonny190/km-worker:v0.2.3` | No | - | - |

A named volume `km-data` mounts at `/data` in both `km-web` and `km-worker` for attachment + export storage.

## Secrets

Three 32-byte base64 values generated locally on the operator machine, saved to `.env.prod.km` (gitignored) for provenance:

- `NEXTAUTH_SECRET` -- NextAuth JWT signing.
- `REALTIME_JWT_SECRET` -- Shared between web (sign) and realtime (verify) for the WS handshake token.
- `REALTIME_ADMIN_SECRET` -- Shared between web (sign) and realtime (verify) for `/internal/ydoc/apply` HMAC.

## Env vars (first deploy)

**km-web:** `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL=https://km.daveys.xyz`, `REALTIME_JWT_SECRET`, `REALTIME_ADMIN_SECRET`, `REALTIME_INTERNAL_URL=http://km-realtime:3001`, `NEXT_PUBLIC_REALTIME_URL=wss://km-ws.daveys.xyz`, `AI_PROVIDER=stub`, `ANTHROPIC_API_KEY=stub`, `EMAIL_PROVIDER=console`, `APP_URL=https://km.daveys.xyz`, `DATA_DIR=/data`, `GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=`, `GITHUB_CLIENT_ID=`, `GITHUB_CLIENT_SECRET=`.

**km-realtime:** `DATABASE_URL`, `REALTIME_JWT_SECRET`, `REALTIME_ADMIN_SECRET`, `REALTIME_PORT=3001`.

**km-worker:** `DATABASE_URL`, `EMAIL_PROVIDER=console`, `AI_PROVIDER=stub`, `DATA_DIR=/data`, `APP_URL=https://km.daveys.xyz`.

## Execution sequence

1. Generate the three secrets locally; save to `.env.prod.km`.
2. Cloudflare API:
   - Add DNS CNAME records for `km` and `km-ws` in the coria zone, proxied, target `<tunnel-id>.cfargotunnel.com`.
   - PUT the tunnel's configuration to add two ingress rules (keeping any pre-existing ones) mapping both hostnames to `http://localhost:80`.
3. Coolify API:
   - Create project `km` on team `Coria`.
   - Create a Postgres service inside that project. Note the internal `DATABASE_URL`.
   - Create three application services pointing at the GHCR images with the env vars above and the named volume mount where applicable.
4. Run the Prisma migration against the new Postgres (via Coolify exec or via the public-mapped port, whichever is available).
5. Start the services in order: Postgres, worker, realtime, web.
6. Smoke test over `https://km.daveys.xyz`: signup, create workspace, create note, open it, confirm the realtime "Live" indicator.
7. Append a record to `infra/coolify/deploy-log.md` noting the tag, date, and any drift between the plan and what actually happened.

## Rollback plan

If step 5 or 6 fails and the issue is image-level, redeploy pointing at a prior tag (`v0.2.2`). If the issue is Coolify config, delete the project and retry. DNS and tunnel routes are additive and harmless to leave.

## Out-of-spec fallbacks noted during run

- If the Coolify API does not support something needed here (creating volumes, binding FQDNs, etc.), fall back to doing it through the Coolify UI manually, then resume the script.
- If the Cloudflare Tunnel config API path differs from the assumed `/accounts/{account}/cfd_tunnel/{tunnelId}/configurations`, adapt per the Cloudflare API docs.
