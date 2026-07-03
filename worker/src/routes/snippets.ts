import { Hono } from 'hono';
import Logger from '../logger.js';
import { SnippetRepository } from '../repositories/snippetRepository.js';
import { AttachmentRepository } from '../repositories/attachmentRepository.js';
import type { AppEnv, SnippetFilters } from '../types.js';

/** Shared by the private and public listing endpoints. */
export function parseQueryParams(query: Record<string, string | undefined>) {
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 100;

  let limit = parseInt(query.limit ?? '') || DEFAULT_LIMIT;
  let offset = parseInt(query.offset ?? '') || 0;

  if (limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  if (offset < 0) offset = 0;

  const categories = query.category
    ? query.category.split(',').map((c) => c.trim().toLowerCase())
    : null;

  const filters: SnippetFilters = {
    search: query.search || null,
    searchCode: query.searchCode === 'true',
    language: query.language || null,
    categories,
    favorites: query.favorites === 'true',
    pinned: query.pinned === 'true',
    recycled: query.recycled === 'true',
  };

  return { limit, offset, filters, sort: query.sort || 'newest' };
}

export function normalizeRawCode(code: string): string {
  // Remove carriage returns to fix bash script execution issues
  return code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const snippets = new Hono<AppEnv>();

// GET all snippets (with pagination and filtering)
snippets.get('/', async (c) => {
  try {
    const { limit, offset, filters, sort } = parseQueryParams(c.req.query());
    const repo = new SnippetRepository(c.env.DB);

    const { snippets: data, total } = await repo.findAllPaginated({
      userId: c.get('user').id,
      filters,
      sort,
      limit,
      offset,
    });

    return c.json({
      data,
      pagination: { total, offset, limit, hasMore: offset + limit < total },
    });
  } catch (error) {
    Logger.error('Error fetching snippets:', error);
    return c.json({ error: 'Failed to fetch snippets' }, 500);
  }
});

snippets.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const repo = new SnippetRepository(c.env.DB);
    const newSnippet = await repo.create(
      { ...body, isPublic: body.is_public || 0 },
      c.get('user').id
    );
    return c.json(newSnippet, 201);
  } catch (error) {
    Logger.error('Error in POST /snippets:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

snippets.get('/metadata', async (c) => {
  try {
    const repo = new SnippetRepository(c.env.DB);
    const metadata = await repo.getMetadata(c.get('user').id);
    return c.json(metadata);
  } catch (error) {
    Logger.error('Error fetching metadata:', error);
    return c.json({ error: 'Failed to fetch metadata' }, 500);
  }
});

snippets.delete('/:id', async (c) => {
  try {
    const repo = new SnippetRepository(c.env.DB);
    const user = c.get('user');
    const id = c.req.param('id');

    // Attachments live in R2; the DB cascade won't clean the bucket
    const attachmentKeys = await new AttachmentRepository(c.env.DB).keysForSnippet(id);

    const result = await repo.delete(id, user.id);
    if (!result) {
      return c.json({ error: 'Snippet not found' }, 404);
    }

    if (attachmentKeys.length > 0) {
      c.executionCtx.waitUntil(c.env.BUCKET.delete(attachmentKeys));
    }
    return c.json({ id: result.id });
  } catch (error) {
    Logger.error('Error in DELETE /snippets/:id:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

snippets.patch('/:id/restore', async (c) => {
  try {
    const repo = new SnippetRepository(c.env.DB);
    await repo.restore(c.req.param('id'), c.get('user').id);
    return c.json({ id: c.req.param('id') });
  } catch (error) {
    Logger.error('Error in PATCH /snippets/:id/restore:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

snippets.patch('/:id/recycle', async (c) => {
  try {
    const repo = new SnippetRepository(c.env.DB);
    const result = await repo.moveToRecycle(c.req.param('id'), c.get('user').id);
    if (!result) {
      return c.json({ error: 'Snippet not found or already moved to recycle bin' }, 404);
    }
    return c.json({ id: result.id });
  } catch (error) {
    Logger.error('Error in PATCH /snippets/:id/recycle:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

snippets.put('/:id', async (c) => {
  try {
    const body = await c.req.json();
    const repo = new SnippetRepository(c.env.DB);
    const updatedSnippet = await repo.update(
      c.req.param('id'),
      { ...body, isPublic: body.is_public || 0 },
      c.get('user').id
    );

    if (!updatedSnippet) {
      return c.json({ error: 'Snippet not found' }, 404);
    }
    return c.json(updatedSnippet);
  } catch (error) {
    Logger.error('Error in PUT /snippets/:id:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Raw snippet endpoint for plain text access
snippets.get('/:id/:fragmentId/raw', async (c) => {
  try {
    const { id, fragmentId } = c.req.param();
    const repo = new SnippetRepository(c.env.DB);
    const snippet = await repo.findById(id, c.get('user').id);
    if (!snippet) {
      return c.text('Snippet not found', 404);
    }

    const fragment = snippet.fragments.find((f) => f.id === parseInt(fragmentId));
    if (!fragment) {
      return c.text('Fragment not found', 404);
    }

    return c.text(normalizeRawCode(fragment.code), 200, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  } catch (error) {
    Logger.error('Error in GET /snippets/:id/raw:', error);
    return c.text('Internal server error', 500);
  }
});

snippets.get('/:id', async (c) => {
  try {
    const repo = new SnippetRepository(c.env.DB);
    const snippet = await repo.findById(c.req.param('id'), c.get('user').id);
    if (!snippet) {
      return c.json({ error: 'Snippet not found' }, 404);
    }
    return c.json(snippet);
  } catch (error) {
    Logger.error('Error in GET /snippets/:id:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

snippets.patch('/:id/pin', async (c) => {
  try {
    const { is_pinned } = await c.req.json();
    const repo = new SnippetRepository(c.env.DB);
    const result = await repo.setPinned(c.req.param('id'), is_pinned, c.get('user').id);
    if (!result) {
      return c.json({ error: 'Snippet not found' }, 404);
    }
    return c.json(result);
  } catch (error) {
    Logger.error('Error in PATCH /snippets/:id/pin:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

snippets.patch('/:id/favorite', async (c) => {
  try {
    const { is_favorite } = await c.req.json();
    const repo = new SnippetRepository(c.env.DB);
    const result = await repo.setFavorite(c.req.param('id'), is_favorite, c.get('user').id);
    if (!result) {
      return c.json({ error: 'Snippet not found' }, 404);
    }
    return c.json(result);
  } catch (error) {
    Logger.error('Error in PATCH /snippets/:id/favorite:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default snippets;
