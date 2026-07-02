import { Hono } from 'hono';
import Logger from '../logger.js';
import { SnippetRepository } from '../repositories/snippetRepository.js';
import { normalizeRawCode, parseQueryParams } from './snippets.js';
import type { AppEnv } from '../types.js';

const publicSnippets = new Hono<AppEnv>();

publicSnippets.get('/', async (c) => {
  try {
    const { limit, offset, filters, sort } = parseQueryParams(c.req.query());
    const repo = new SnippetRepository(c.env.DB);

    const { snippets, total } = await repo.findAllPaginated({
      userId: null, // null = public only
      filters,
      sort,
      limit,
      offset,
    });

    return c.json({
      data: snippets,
      pagination: { total, offset, limit, hasMore: offset + limit < total },
    });
  } catch (error) {
    Logger.error('Error fetching public snippets:', error);
    return c.json({ error: 'Failed to fetch public snippets' }, 500);
  }
});

publicSnippets.get('/metadata', async (c) => {
  try {
    const repo = new SnippetRepository(c.env.DB);
    const metadata = await repo.getMetadata(null);
    return c.json(metadata);
  } catch (error) {
    Logger.error('Error fetching public metadata:', error);
    return c.json({ error: 'Failed to fetch metadata' }, 500);
  }
});

publicSnippets.get('/:id/:fragmentId/raw', async (c) => {
  try {
    const { id, fragmentId } = c.req.param();
    const repo = new SnippetRepository(c.env.DB);
    const snippet = await repo.findById(id);
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
    Logger.error('Error in GET /public/snippets/:id/raw:', error);
    return c.text('Internal server error', 500);
  }
});

publicSnippets.get('/:id', async (c) => {
  try {
    const repo = new SnippetRepository(c.env.DB);
    const snippet = await repo.findById(c.req.param('id'));
    if (!snippet) {
      return c.json({ error: 'Snippet not found' }, 404);
    }
    return c.json(snippet);
  } catch (error) {
    Logger.error('Error in GET /public/snippets/:id:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default publicSnippets;
