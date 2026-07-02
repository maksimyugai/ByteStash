# Миграция ByteStash на Cloudflare — итог

Дата: 2026-07-02 · Ветка: `cf-migration` · Статус: **код мигрирован, ожидает создания ресурсов и cutover**

Практическое руководство по деплою, настройке Access и импорту данных: **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Целевая архитектура (реализована)

```
[Cloudflare Access] → [Worker: Hono API + Static Assets (client/build)]
                            ├── D1  bytestash-db          (вся БД, схема = init.sql Node-версии)
                            ├── R2  bytestash-files       (вложения + ночные NDJSON-бэкапы)
                            └── Cron Trigger 03:00 UTC    (purge корзины/шар, бэкап)
```

## Принятые решения

1. **Workers + Static Assets, не Pages** — Pages в maintenance-режиме; не Containers — у них эфемерный диск, D1 всё равно обязателен, а биндинга D1 из контейнера нет.
2. **Публичные шары и эмбеды остаются анонимными** — path-based Bypass-политики Access (`/api/share`, `/api/embed`, `/api/public`, статика); «requires auth»-шары проверяются приложением по `CF_Authorization`-cookie.
3. **Auth = Access-only**: пользователи auto-provision из Access JWT (JWKS + aud, библиотека `jose`); bcrypt, пароли, собственный JWT и OIDC-код удалены. API-ключи сохранены (REST + MCP).
4. **Форк Workers-only**: `server/`, Dockerfile, docker-compose, helm-charts удалены; Docker-путь остаётся в upstream.

## Что где лежит

| Что | Где |
|---|---|
| Worker (Hono, TypeScript) | `worker/src/` — routes/, middleware/, repositories/, mcp/, scheduled.ts |
| Конфиг + биндинги | `worker/wrangler.jsonc` |
| D1-миграции | `worker/migrations/0001_init.sql` (squash 11 старых), `0002_attachments.sql` |
| Тесты (23, vitest-pool-workers, реальные локальные D1/R2) | `worker/test/` |
| CI/CD (тест + деплой + d1 migrations apply) | `.github/workflows/deploy.yml` |
| Swagger UI (статический) | `client/public/api-docs/` |
| Runbook импорта SQLite → D1 | DEPLOYMENT.md §6 |

## Ключевые технические замены

- better-sqlite3 (sync) → D1 (async): `db.batch()` вместо транзакций; для create — `INSERT … RETURNING id` + батч дочерних вставок с компенсацией; для update — единый атомарный батч. Фрагменты для списков забираются чанкованными `IN()`-запросами вместо N+1.
- `jsonwebtoken`/`bcrypt`/`crypto.randomBytes` → `jose` (только верификация Access JWT), WebCrypto (`getRandomValues`, `randomUUID`).
- Express → Hono; BASE_PATH-хак с runtime-переписью index.html удалён (сервис живёт на корне хостнейма).
- MCP: тот же `McpServer` из SDK, транспорт → `@hono/mcp` (stateless, per-request).
- swagger-ui-express → статическая страница + swagger.yaml (обновлён: без login/register/OIDC, добавлены attachments).
- Checkpoint/backup-механика SQLite → D1 Time Travel + ночной экспорт NDJSON в R2.
- Новая фича: вложения к сниппетам в R2 (`/api/snippets/:id/attachments`, стриминг, лимит 25 MB, UI в модалке сниппета).

## Осталось до продакшена (см. DEPLOYMENT.md)

1. `wrangler d1 create` / `r2 bucket create`, прописать `database_id`.
2. Настроить Access-приложения (Allow + Bypass-пути + Service Auth для MCP), заполнить `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`/`ADMIN_USERNAMES`.
3. Импорт данных из старого snippets.db (data-only dump; пре-линковка старых пользователей к Access-идентичностям — SQL в runbook).
4. Секреты GitHub Actions (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) и первый деплой.
5. Смоук-чеклист (DEPLOYMENT.md §8), старый инстанс — read-only на переходный период.
