# ByteStash migration to Cloudflare — summary

Date: 2026-07-02 · Branch: `cf-migration` · Status: **code migrated, deployed to production**

Hands-on guide for deployment, Access setup and data import: **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Target architecture (implemented)

```
[Cloudflare Access] → [Worker: Hono API + Static Assets (client/build)]
                            ├── D1  bytestash-db          (entire DB, schema = the Node version's init.sql)
                            ├── R2  bytestash-files       (attachments + nightly NDJSON backups)
                            └── Cron Trigger 03:00 UTC    (purge recycle bin/shares, backup)
```

## Decisions made

1. **Workers + Static Assets, not Pages** — Pages is in maintenance mode; not Containers either — their disk is ephemeral, D1 would be required anyway, and there is no D1 binding from inside a container.
2. **Public shares and embeds stay anonymous** — the worker enforces all privacy itself, so Access guards only the login trigger path (`/auth/login`); "requires auth" shares are validated by the app via the `CF_Authorization` cookie.
3. **Auth = Access-only**: users are auto-provisioned from the Access JWT (JWKS + aud, `jose` library); bcrypt, passwords, the app's own JWT and the OIDC code were removed. API keys are kept (REST + MCP). Migrated accounts are claimed on first login by matching the email list stored on the user row.
4. **Workers-only fork**: `server/`, Dockerfile, docker-compose, helm-charts were removed; the Docker path lives on in upstream.

## Where things live

| What | Where |
|---|---|
| Worker (Hono, TypeScript) | `worker/src/` — routes/, middleware/, repositories/, mcp/, scheduled.ts |
| Config + bindings | `worker/wrangler.jsonc` |
| D1 migrations | `worker/migrations/0001_init.sql` (11 legacy migrations squashed), `0002_attachments.sql` |
| Tests (23, vitest-pool-workers, real local D1/R2) | `worker/test/` |
| CI/CD (test + deploy + d1 migrations apply) | `.github/workflows/deploy.yml` |
| Swagger UI (static) | `client/public/api-docs/` |
| SQLite → D1 import runbook | DEPLOYMENT.md §6 |

## Key technical replacements

- better-sqlite3 (sync) → D1 (async): `db.batch()` instead of transactions; create = `INSERT … RETURNING id` + a batch of child inserts with compensation; update = a single atomic batch. Fragments for list views are fetched with chunked `IN()` queries instead of N+1.
- `jsonwebtoken`/`bcrypt`/`crypto.randomBytes` → `jose` (Access JWT verification only), WebCrypto (`getRandomValues`, `randomUUID`).
- Express → Hono; the BASE_PATH hack with runtime index.html rewriting was removed (the service lives at the root of its hostname).
- MCP: the same `McpServer` from the SDK, transport → `@hono/mcp` (stateless, per-request).
- swagger-ui-express → a static page + swagger.yaml (updated: no login/register/OIDC, attachments added).
- SQLite checkpoint/backup machinery → D1 Time Travel + a nightly NDJSON export to R2.
- New feature: snippet file attachments in R2 (`/api/snippets/:id/attachments`, streaming, 25 MB cap, UI in the snippet modal).

## Production state

1. Worker deployed to the custom domain (workers.dev and preview URLs are disabled via `workers_dev: false` — wrangler would otherwise re-enable them on every deploy).
2. The old `bytestash` worker in the account was a Cloudflare Containers experiment (a `ByteStash` Durable Object supervising containers); it was replaced in place using a `deleted_classes` DO migration, and the leftover container application/images were removed.
3. Data from the pre-migration SQLite instance was imported into production D1 (users/snippets/fragments/categories verified by row counts). The personal seed migration (`0003_import_data.sql`) is intentionally **git-ignored** — snippet bodies contain live credentials.
4. Cloudflare Access application is scoped to `snippets.<domain>/auth/login` with an Allow policy; everything else is public-by-default with worker-enforced authorization (401 for private endpoints, `is_public = 1` filters for public ones).
