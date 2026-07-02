# ByteStash
<p align="center">
  <img src="https://raw.githubusercontent.com/jordan-dalby/ByteStash/refs/heads/main/client/public/logo192.png" />
</p>

ByteStash is a self-hosted web application designed to store, organise, and manage your code snippets efficiently. With support for creating, editing, and filtering snippets, ByteStash helps you keep track of your code in one secure place.

![ByteStash App](https://raw.githubusercontent.com/jordan-dalby/ByteStash/refs/heads/main/media/app-image.png)

> **Note:** this fork is a full port of ByteStash to the Cloudflare stack —
> Workers (API + static assets), D1 (database), R2 (attachments & backups) and
> Cloudflare Access (authentication). For the original self-hosted Docker
> version see [jordan-dalby/ByteStash](https://github.com/jordan-dalby/ByteStash).

## Deployment
See [DEPLOYMENT.md](DEPLOYMENT.md) for the full guide: creating the D1/R2
resources, configuring Cloudflare Access policies (including public share
links and embeds), CI/CD, local development, and importing data from an
existing SQLite instance.

Quick version:

```bash
cd worker
npx wrangler d1 create bytestash-db      # put the id into wrangler.jsonc
npx wrangler r2 bucket create bytestash-files
npx wrangler d1 migrations apply bytestash-db --remote
cd ../client && npm ci && npm run build
cd ../worker && npm ci && npx wrangler deploy
```

## Tech Stack
- Frontend: React, Tailwind CSS (served as Workers static assets)
- Backend: Hono on Cloudflare Workers
- Database: Cloudflare D1 (SQLite)
- Files & backups: Cloudflare R2
- Authentication: Cloudflare Access

## API Documentation
Once the server is running you can explore the API via Swagger UI. Open
`/api-docs` in your browser to view the documentation for all endpoints.

## MCP (AI assistants)
ByteStash exposes a remote [Model Context Protocol](https://modelcontextprotocol.io)
endpoint so AI assistants such as **Claude** (desktop & web), **OpenAI/ChatGPT** and
**Perplexity** can search, read and manage your snippets directly.

- **Endpoint:** `https://<your-host>/mcp`. It is served on the same host/port as the app, so nothing extra
  needs to be exposed in your deployment.
- **Transport:** Streamable HTTP.
- **Auth:** the **same API key** used by the REST API. Create one under
  *Settings → API Keys* in the UI, then send it as `Authorization: Bearer <api-key>`
  (or the `x-api-key` header). The MCP tools only ever access snippets owned by that key.

### Available tools
`list_snippets`, `get_snippet`, `create_snippet`, `update_snippet`, `delete_snippet`,
`list_metadata`.

### Connecting clients
- **Claude Desktop** (`claude_desktop_config.json`):
  ```json
  {
    "mcpServers": {
      "bytestash": {
        "type": "http",
        "url": "https://your-host/mcp",
        "headers": { "Authorization": "Bearer YOUR_API_KEY" }
      }
    }
  }
  ```
- **Claude.ai / web & other custom connectors:** add a custom connector pointing at
  `https://your-host/mcp` and supply the `Authorization: Bearer YOUR_API_KEY` header.
- **OpenAI Responses API:** pass it as an MCP tool:
  ```json
  {
    "type": "mcp",
    "server_label": "bytestash",
    "server_url": "https://your-host/mcp",
    "headers": { "Authorization": "Bearer YOUR_API_KEY" }
  }
  ```
- **Perplexity:** add a remote MCP connector with the URL above and the same
  `Authorization` header.

> If the `/mcp` path sits behind a Cloudflare Access *Service Auth* policy, MCP
> clients must additionally send the Access service-token headers
> (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) — or scope a Bypass
> policy to `/mcp` and rely on the API key alone. See
> [DEPLOYMENT.md](DEPLOYMENT.md).

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any improvements or bug fixes.

### I18n
To add phrases for a new language, follow these steps. Example for `fr` locale:
- Add the locale name to the `Locale` enum in the `client/src/i18n/types.ts` file
- Add the locale name to the `locales` array in the `client/i18next.config.ts` file
- Run translation synchronization: `cd client && npm run i18n:extract`
- Replace all `__TRANSLATE_ME__` lines with the desired phrases
- Create new resources file as `client/src/i18n/resources/fr.ts`
- Update export resources in file `client/src/i18n/resources/index.ts`
- Run the server in development mode: `npm run dev`
- Run the client in development mode: `cd client && npm run start`
