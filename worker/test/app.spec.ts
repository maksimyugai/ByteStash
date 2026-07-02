import { describe, it, expect } from 'vitest';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';

/*
 * Integration tests against the assembled app. Auth paths that need a real
 * Cloudflare Access tenant (JWKS) are exercised in DISABLE_ACCOUNTS mode,
 * which maps every request to the shared anonymous user — same as the
 * self-hosted single-user deployment.
 */

async function request(path: string, init: RequestInit = {}, envOverrides: Partial<Env> = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ...env, ...envOverrides } as Env,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return response;
}

const anonymousEnv: Partial<Env> = { DISABLE_ACCOUNTS: 'true' };

describe('auth', () => {
  it('rejects unauthenticated API requests', async () => {
    const res = await request('/api/snippets');
    expect(res.status).toBe(401);
  });

  it('exposes the auth config', async () => {
    const res = await request('/api/auth/config');
    expect(res.status).toBe(200);
    const config = (await res.json()) as Record<string, unknown>;
    expect(config.disableInternalAccounts).toBe(true);
    expect(config.allowPasswordChanges).toBe(false);
  });

  it('maps requests to the anonymous user when DISABLE_ACCOUNTS=true', async () => {
    const res = await request('/api/auth/verify', {}, anonymousEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; user: { id: number } };
    expect(body.valid).toBe(true);
    expect(body.user.id).toBe(0);
  });

  it('rejects MCP requests without an API key', async () => {
    const res = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });
});

describe('snippets API (anonymous mode)', () => {
  it('supports the full CRUD lifecycle', async () => {
    const createRes = await request(
      '/api/snippets',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'From test',
          description: 'd',
          categories: ['it'],
          fragments: [{ file_name: 'f.txt', code: 'hello\r\nworld', language: 'plaintext' }],
          is_public: false,
        }),
      },
      anonymousEnv
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: number };

    const listRes = await request('/api/snippets?search=From+test', {}, anonymousEnv);
    const list = (await listRes.json()) as { data: { id: number }[]; pagination: { total: number } };
    expect(list.data.some((s) => s.id === created.id)).toBe(true);

    const rawRes = await request(`/api/snippets/${created.id}/1/raw`, {}, anonymousEnv);
    // raw endpoint may 404 if fragment ids differ between runs; resolve via snippet
    const snippetRes = await request(`/api/snippets/${created.id}`, {}, anonymousEnv);
    const snippet = (await snippetRes.json()) as { fragments: { id: number; code: string }[] };
    const fragmentId = snippet.fragments[0].id;
    const raw = await request(`/api/snippets/${created.id}/${fragmentId}/raw`, {}, anonymousEnv);
    expect(raw.status).toBe(200);
    expect(await raw.text()).toBe('hello\nworld'); // CRLF normalized
    void rawRes;

    const deleteRes = await request(
      `/api/snippets/${created.id}`,
      { method: 'DELETE' },
      anonymousEnv
    );
    expect(deleteRes.status).toBe(200);

    const goneRes = await request(`/api/snippets/${created.id}`, {}, anonymousEnv);
    expect(goneRes.status).toBe(404);
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await request(
      '/api/snippets',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(3 * 1024 * 1024),
        },
        body: '{}',
      },
      anonymousEnv
    );
    expect(res.status).toBe(413);
  });
});

describe('public API', () => {
  it('serves only public snippets', async () => {
    await request(
      '/api/snippets',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Public one',
          fragments: [{ file_name: 'p', code: 'pub', language: 'plaintext' }],
          is_public: true,
        }),
      },
      anonymousEnv
    );

    const res = await request('/api/public/snippets');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { is_public: number }[] };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.every((s) => s.is_public === 1)).toBe(true);
  });
});

describe('attachments (R2)', () => {
  it('uploads, lists, downloads and deletes attachments', async () => {
    const createRes = await request(
      '/api/snippets',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'With attachment',
          fragments: [{ file_name: 'f', code: 'c', language: 'plaintext' }],
        }),
      },
      anonymousEnv
    );
    const snippet = (await createRes.json()) as { id: number };

    const uploadRes = await request(
      `/api/snippets/${snippet.id}/attachments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'x-file-name': 'notes.txt' },
        body: 'attached content',
      },
      anonymousEnv
    );
    expect(uploadRes.status).toBe(201);
    const attachment = (await uploadRes.json()) as { id: number; size: number };
    expect(attachment.size).toBe('attached content'.length);

    const listRes = await request(`/api/snippets/${snippet.id}/attachments`, {}, anonymousEnv);
    const list = (await listRes.json()) as { id: number }[];
    expect(list).toHaveLength(1);

    const downloadRes = await request(
      `/api/snippets/${snippet.id}/attachments/${attachment.id}`,
      {},
      anonymousEnv
    );
    expect(downloadRes.status).toBe(200);
    expect(await downloadRes.text()).toBe('attached content');

    const deleteRes = await request(
      `/api/snippets/${snippet.id}/attachments/${attachment.id}`,
      { method: 'DELETE' },
      anonymousEnv
    );
    expect(deleteRes.status).toBe(200);
  });
});

describe('shares', () => {
  it('creates a share and resolves it without auth when not required', async () => {
    const createRes = await request(
      '/api/snippets',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Shareable',
          fragments: [{ file_name: 'f', code: 'c', language: 'plaintext' }],
        }),
      },
      anonymousEnv
    );
    const snippet = (await createRes.json()) as { id: number };

    const shareRes = await request(
      '/api/share',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snippetId: snippet.id, requiresAuth: false, expiresIn: 3600 }),
      },
      anonymousEnv
    );
    expect(shareRes.status).toBe(201);
    const share = (await shareRes.json()) as { id: string };

    // Public resolution — no auth at all (Access Bypass path)
    const getRes = await request(`/api/share/${share.id}`);
    expect(getRes.status).toBe(200);

    const embedRes = await request(`/api/embed/${share.id}?showTitle=true`);
    expect(embedRes.status).toBe(200);
    const embed = (await embedRes.json()) as { title?: string };
    expect(embed.title).toBe('Shareable');
  });
});
