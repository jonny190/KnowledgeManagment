# Architecture

The platform is a Next.js application backed by Postgres. A second Node service consumes background jobs from the same database. All persistent state, including queue state, lives in Postgres.

```
       Cloudflare (HTTPS)
              |
              v
          web (Next.js) ----+------> Postgres
              |             |
              |             |
              +---> pg-boss queue
                            |
                            v
                      worker (Node)
                            |
                            v
                     /data volume
                   (attachments, exports)
```

Services and responsibilities:

- web: serves the UI and all API routes. Enqueues export jobs through pg-boss. Reads and writes attachments directly from the shared `/data` volume. Terminates its own session checks via NextAuth against the shared database.
- worker: long-running Node process that subscribes to the `export-vault` queue and the `export-vault-scheduled` queue. Renders vault contents to a filesystem directory, zips the result, and updates the `ExportJob` row.
- postgres: single Postgres instance that holds application data, NextAuth sessions, and pg-boss queue state.
- /data volume: Docker named volume mounted in both web and worker. Attachments live at `/data/vaults/<vaultId>/attachments/`. Exports live at `/data/exports/<jobId>.zip`.

The web and worker deploy independently but are built from the same monorepo so they always share types and the Prisma client.
