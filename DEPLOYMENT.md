# Deploying ByteStash to Cloudflare

This fork runs entirely on Cloudflare: a single **Worker** serves the API and the
React client (static assets), **D1** stores the data, **R2** stores file
attachments and nightly backups, and **Cloudflare Access** handles
authentication at the edge.

```
[Cloudflare Access] → [Worker: Hono API + Static Assets (client/build)]
                            ├── D1  bytestash-db
                            ├── R2  bytestash-files (attachments + backups)
                            └── Cron Trigger 03:00 UTC (purge expired, backup)
```

## 1. Prerequisites

- A Cloudflare account (Workers **paid** plan recommended; free works for light use)
- `wrangler` ≥ 4 authenticated: `npx wrangler login`
- Node 22+

## 2. Create resources

```bash
cd worker
npx wrangler d1 create bytestash-db      # copy database_id into wrangler.jsonc
npx wrangler r2 bucket create bytestash-files
```

Put the returned `database_id` into `worker/wrangler.jsonc` (`d1_databases[0].database_id`).

## 3. Configure

All configuration lives in `worker/wrangler.jsonc` (`vars`):

| Var | Meaning |
|---|---|
| `ACCESS_TEAM_DOMAIN` | Your Access team domain, e.g. `myteam.cloudflareaccess.com` |
| `ACCESS_AUD` | The Application Audience (AUD) tag of the Access application |
| `ADMIN_USERNAMES` | Comma-separated usernames that get the admin panel |
| `DISABLE_ACCOUNTS` | `true` = single-user mode without accounts (maps everyone to the shared anonymous user) |
| `DEBUG` | `true` enables debug logging |
| `DEV_AUTH` | **Local dev only** — auto-login as a `dev` user. Never enable in production |

There are no secrets to set: passwords, JWT signing and OIDC were removed —
identity comes from the Access JWT.

## 4. Cloudflare Access setup

Create a **self-hosted Access application** for your hostname
(Zero Trust → Access → Applications):

1. **Main application** — domain `snippets.example.com`, session ~24h.
   Policy: *Allow* for your users (email / IdP group). Copy the **AUD tag**
   into `ACCESS_AUD`.
2. **Bypass application(s)** for the public surface (path-scoped applications
   on the same hostname), each with a single *Bypass → Everyone* policy:
   - `snippets.example.com/api/embed`
   - `snippets.example.com/api/share`
   - `snippets.example.com/api/public`
   - `snippets.example.com/assets`
   - `snippets.example.com/monacoeditorwork`
   - `snippets.example.com/share` (SPA route for share links)
   - `snippets.example.com/embed` (SPA route for embeds)
   - `snippets.example.com/manifest.json`, `/favicon.ico`, `/api-docs`

   "Requires auth" share links still work: the app validates the visitor's
   `CF_Authorization` cookie itself on bypassed paths.
3. **Service application** for non-browser clients (MCP, scripts) on
   `snippets.example.com/mcp` and `snippets.example.com/api/snippets` with a
   *Service Auth* policy (Access service tokens), **or** a Bypass policy if you
   are comfortable relying on ByteStash API keys alone — the app always
   requires a valid API key on `/mcp` and accepts one on `/api/snippets`
   regardless of the Access decision.

How auth flows end to end:

- Browser → Access login → request carries `Cf-Access-Jwt-Assertion` → the
  worker validates it against `https://<team>/cdn-cgi/access/certs` (issuer +
  AUD) and auto-provisions the user on first sight (email → username).
- Users are stored in the existing `users` table with
  `oidc_provider = 'cloudflare-access'`; no schema change was needed.
- Logout button sends the browser to `https://<team>/cdn-cgi/access/logout`.
- MCP / API clients send `Authorization: Bearer <bytestash-api-key>` (or
  `x-api-key`) plus, if you chose Service Auth, the Access service-token
  headers (`CF-Access-Client-Id` / `CF-Access-Client-Secret`).

## 5. Deploy

```bash
cd client && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 migrations apply bytestash-db --remote
npx wrangler deploy
```

Or push to `main`/`cf-migration` with the GitHub Action
(`.github/workflows/deploy.yml`) — set the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets.

## 6. Importing data from an existing (Docker/SQLite) instance

The D1 schema is identical to the final schema of the Node version, so a
data-only import works:

```bash
# 1. On the old instance (stop it first, or use the .backup file)
sqlite3 /data/snippets/snippets.db .dump > dump.sql

# 2. Keep only INSERTs, relax FK ordering
grep '^INSERT INTO' dump.sql | grep -v 'sqlite_sequence' > data.sql
sed -i '1i PRAGMA defer_foreign_keys = true;' data.sql

# 3. Import into D1 (migrations must already be applied)
cd worker
npx wrangler d1 execute bytestash-db --remote --file=../data.sql

# 4. Verify row counts
npx wrangler d1 execute bytestash-db --remote --command \
  "SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM snippets) snippets, (SELECT COUNT(*) FROM fragments) fragments, (SELECT COUNT(*) FROM shared_snippets) shares, (SELECT COUNT(*) FROM api_keys) api_keys"
```

Notes:

- Existing **API keys keep working** as-is.
- Existing **password hashes are ignored** — there is no password login
  anymore. Users are matched by Access identity; a previously-registered user
  will get a *new* user row on first Access login unless you pre-link them:
  ```sql
  UPDATE users SET oidc_id = '<email>', oidc_provider = 'cloudflare-access'
  WHERE username = '<old-username>';
  ```
  (`oidc_id` must equal the `sub` claim of the Access JWT; if your IdP has no
  stable sub, the app falls back to email.)
- D1 **Time Travel** gives 30-day point-in-time restore out of the box; the
  worker additionally exports NDJSON dumps of every table to
  `backups/YYYY-MM-DD/` in the R2 bucket each night.

## 7. Local development

```bash
cd client && npm run build        # or `npm start` + proxy for hot reload
cd ../worker
npx wrangler d1 migrations apply bytestash-db --local
npx wrangler dev --var DEV_AUTH:true     # http://localhost:8787
```

- `DEV_AUTH:true` signs you in as a local `dev` user without Access.
- Cron: `npx wrangler dev --test-scheduled`, then
  `curl 'http://localhost:8787/__scheduled?cron=0+3+*+*+*'`.
- Tests: `cd worker && npm test` (vitest-pool-workers with a real local D1/R2).
- Typecheck: `npm run check`.

## 8. Smoke checklist after deploy

- [ ] Login through Access, create/edit/delete a snippet with several fragments
- [ ] Pin/favorite, recycle bin → restore
- [ ] Create a share link — open it in an incognito window (no Access login)
- [ ] Embed renders on an external page
- [ ] API key: `curl -H "x-api-key: <key>" https://host/api/snippets`
- [ ] MCP: connect Claude with `https://host/mcp` + the API key as bearer token
- [ ] Attachments: upload/download/delete; object visible in the R2 bucket
- [ ] `/api-docs` renders Swagger UI
- [ ] Admin panel reachable for `ADMIN_USERNAMES`
