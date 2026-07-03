import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { SnippetRepository } from '../src/repositories/snippetRepository.js';
import { UserRepository } from '../src/repositories/userRepository.js';
import { ApiKeyRepository } from '../src/repositories/apiKeyRepository.js';
import { ShareRepository } from '../src/repositories/shareRepository.js';

let userId: number;
let otherUserId: number;

beforeAll(async () => {
  const users = new UserRepository(env.DB);
  const user = await users.findOrCreateAccessUser({ sub: 'u1', email: 'u1@example.com' });
  const other = await users.findOrCreateAccessUser({ sub: 'u2', email: 'u2@example.com' });
  userId = user.id;
  otherUserId = other.id;
});

describe('UserRepository', () => {
  it('provisions Access users idempotently', async () => {
    const users = new UserRepository(env.DB);
    const again = await users.findOrCreateAccessUser({ sub: 'u1', email: 'u1@example.com' });
    expect(again.id).toBe(userId);
  });

  it('deduplicates usernames derived from equal email local parts', async () => {
    const users = new UserRepository(env.DB);
    const a = await users.findOrCreateAccessUser({ sub: 'dup-a', email: 'john@a.com' });
    const b = await users.findOrCreateAccessUser({ sub: 'dup-b', email: 'john@b.com' });
    expect(a.username).not.toBe(b.username);
  });

  it('links an Access identity to a migrated account by any of its emails', async () => {
    const users = new UserRepository(env.DB);
    await env.DB.prepare(
      `INSERT INTO users (username, username_normalized, password_hash, email)
       VALUES ('legacy', 'legacy', '', 'One@a.com, two@b.com')`
    ).run();

    // First login (first email) adopts the account and links the identity
    const first = await users.findOrCreateAccessUser({ sub: 'sub-1', email: 'one@a.com' });
    expect(first.username).toBe('legacy');

    // Same identity again resolves via the oidc link
    const again = await users.findOrCreateAccessUser({ sub: 'sub-1', email: 'one@a.com' });
    expect(again.id).toBe(first.id);

    // A different identity with the second listed email maps to the same account
    const second = await users.findOrCreateAccessUser({ sub: 'sub-2', email: 'two@b.com' });
    expect(second.id).toBe(first.id);

    // The original link is kept, not overwritten by the secondary email
    const row = await env.DB.prepare('SELECT oidc_id FROM users WHERE id = ?')
      .bind(first.id)
      .first<{ oidc_id: string }>();
    expect(row!.oidc_id).toBe('sub-1');

    // An unrelated email still provisions a fresh user
    const stranger = await users.findOrCreateAccessUser({ sub: 'sub-3', email: 'three@c.com' });
    expect(stranger.id).not.toBe(first.id);
  });

  it('creates the shared anonymous user with id 0', async () => {
    const users = new UserRepository(env.DB);
    const anon = await users.getOrCreateAnonymousUser();
    expect(anon.id).toBe(0);
    const again = await users.getOrCreateAnonymousUser();
    expect(again.id).toBe(0);
  });
});

describe('SnippetRepository', () => {
  it('creates a snippet with fragments and categories atomically', async () => {
    const repo = new SnippetRepository(env.DB);
    const created = await repo.create(
      {
        title: 'Hello',
        description: 'World',
        categories: ['Web ', 'api'],
        fragments: [
          { file_name: 'a.ts', code: 'const a = 1;', language: 'typescript', position: 0 },
          { file_name: 'b.ts', code: 'const b = 2;', language: 'typescript', position: 1 },
        ],
        isPublic: 0,
      },
      userId
    );

    expect(created).not.toBeNull();
    expect(created!.fragments).toHaveLength(2);
    expect(created!.categories.sort()).toEqual(['api', 'web']);
    expect(created!.share_count).toBe(0);
  });

  it('replaces fragments and categories on update', async () => {
    const repo = new SnippetRepository(env.DB);
    const created = await repo.create(
      {
        title: 'To update',
        categories: ['old'],
        fragments: [{ file_name: 'x', code: 'old', language: 'plaintext', position: 0 }],
      },
      userId
    );

    const updated = await repo.update(
      created!.id,
      {
        title: 'Updated',
        description: 'new desc',
        categories: ['new'],
        fragments: [{ file_name: 'y', code: 'new', language: 'plaintext', position: 0 }],
        isPublic: 1,
      },
      userId
    );

    expect(updated!.title).toBe('Updated');
    expect(updated!.categories).toEqual(['new']);
    expect(updated!.fragments).toHaveLength(1);
    expect(updated!.fragments[0].file_name).toBe('y');
    expect(updated!.is_public).toBe(1);
  });

  it('does not let another user update a snippet', async () => {
    const repo = new SnippetRepository(env.DB);
    const created = await repo.create(
      { title: 'Mine', fragments: [{ file_name: 'f', code: 'c', language: 'txt', position: 0 }] },
      userId
    );

    const result = await repo.update(
      created!.id,
      { title: 'Stolen', fragments: [], categories: [] },
      otherUserId
    );
    expect(result).toBeNull();

    const still = await repo.findById(created!.id, userId);
    expect(still!.title).toBe('Mine');
    expect(still!.fragments).toHaveLength(1);
  });

  it('filters paginated results by search and category', async () => {
    const repo = new SnippetRepository(env.DB);
    await repo.create(
      {
        title: 'Unique needle title',
        categories: ['haystack'],
        fragments: [{ file_name: 'n', code: 'needle-in-code', language: 'txt', position: 0 }],
      },
      userId
    );

    const bySearch = await repo.findAllPaginated({
      userId,
      filters: { search: 'needle', searchCode: true },
    });
    expect(bySearch.snippets.length).toBeGreaterThanOrEqual(1);
    expect(bySearch.snippets.some((s) => s.title === 'Unique needle title')).toBe(true);

    const byCategory = await repo.findAllPaginated({
      userId,
      filters: { categories: ['haystack'] },
    });
    expect(byCategory.snippets).toHaveLength(1);
    expect(byCategory.total).toBe(1);
  });

  it('recycles, restores and purges expired snippets', async () => {
    const repo = new SnippetRepository(env.DB);
    const created = await repo.create(
      { title: 'Recyclable', fragments: [{ file_name: 'f', code: 'c', language: 'txt', position: 0 }] },
      userId
    );

    const recycled = await repo.moveToRecycle(created!.id, userId);
    expect(recycled!.id).toBe(created!.id);
    expect(await repo.findById(created!.id, userId)).toBeNull();

    await repo.restore(created!.id, userId);
    expect(await repo.findById(created!.id, userId)).not.toBeNull();

    // Recycle again, force-expire, purge
    await repo.moveToRecycle(created!.id, userId);
    await env.DB.prepare(
      `UPDATE snippets SET expiry_date = datetime('now', '-1 day') WHERE id = ?`
    )
      .bind(created!.id)
      .run();
    const deleted = await repo.deleteExpired();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(
      await env.DB.prepare('SELECT id FROM snippets WHERE id = ?').bind(created!.id).first()
    ).toBeNull();
  });

  it('does not let a user recycle another user’s public snippet', async () => {
    const repo = new SnippetRepository(env.DB);
    const created = await repo.create(
      {
        title: 'Public of u1',
        isPublic: 1,
        fragments: [{ file_name: 'f', code: 'c', language: 'txt', position: 0 }],
      },
      userId
    );

    const result = await repo.moveToRecycle(created!.id, otherUserId);
    expect(result).toBeNull();
  });

  it('returns metadata scoped to the user', async () => {
    // Storage is isolated per test — create the data inside the test
    const repo = new SnippetRepository(env.DB);
    await repo.create(
      {
        title: 'For metadata',
        categories: ['meta-cat'],
        fragments: [{ file_name: 'm', code: 'c', language: 'go', position: 0 }],
      },
      userId
    );
    await repo.create(
      {
        title: 'Not mine',
        categories: ['other-cat'],
        fragments: [{ file_name: 'o', code: 'c', language: 'rust', position: 0 }],
      },
      otherUserId
    );

    const meta = await repo.getMetadata(userId);
    expect(meta.counts.total).toBe(1);
    expect(meta.categories).toEqual(['meta-cat']);
    expect(meta.languages).toEqual(['go']);
  });
});

describe('ApiKeyRepository', () => {
  it('creates and validates API keys', async () => {
    const repo = new ApiKeyRepository(env.DB);
    const created = await repo.createApiKey(userId, 'test key');
    expect(created!.key).toMatch(/^[0-9a-f]{64}$/);

    const valid = await repo.validateApiKey(created!.key);
    expect(valid).toEqual({ userId, keyId: created!.id });

    expect(await repo.validateApiKey('nope')).toBeNull();
  });

  it('scopes deletion to the owner', async () => {
    const repo = new ApiKeyRepository(env.DB);
    const created = await repo.createApiKey(userId, 'delete me');
    expect(await repo.deleteApiKey(otherUserId, created!.id)).toBe(false);
    expect(await repo.deleteApiKey(userId, created!.id)).toBe(true);
  });
});

describe('ShareRepository', () => {
  it('creates and resolves shares, enforcing ownership', async () => {
    const snippets = new SnippetRepository(env.DB);
    const snippet = await snippets.create(
      { title: 'Shared', fragments: [{ file_name: 'f', code: 'c', language: 'txt', position: 0 }] },
      userId
    );

    const shares = new ShareRepository(env.DB);
    await expect(
      shares.createShare({ snippetId: snippet!.id, requiresAuth: false, expiresIn: 60 }, otherUserId)
    ).rejects.toThrow('Unauthorized');

    const share = await shares.createShare(
      { snippetId: snippet!.id, requiresAuth: true, expiresIn: 60 },
      userId
    );

    const resolved = await shares.getShare(share.id);
    expect(resolved!.title).toBe('Shared');
    expect(resolved!.share.requiresAuth).toBe(true);
    expect(resolved!.share.expired).toBe(false);
    expect(resolved!.fragments).toHaveLength(1);
  });

  it('purges expired shares', async () => {
    const snippets = new SnippetRepository(env.DB);
    const snippet = await snippets.create(
      { title: 'Expiring', fragments: [{ file_name: 'f', code: 'c', language: 'txt', position: 0 }] },
      userId
    );

    const shares = new ShareRepository(env.DB);
    const share = await shares.createShare(
      { snippetId: snippet!.id, requiresAuth: false, expiresIn: 60 },
      userId
    );
    await env.DB.prepare(
      `UPDATE shared_snippets SET expires_at = datetime('now', '-1 hour') WHERE id = ?`
    )
      .bind(share.id)
      .run();

    const deleted = await shares.deleteExpiredShares();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await shares.getShare(share.id)).toBeNull();
  });
});
