import { Hono } from 'hono';
import Logger from '../logger.js';
import { resolveUser } from '../middleware/auth.js';
import { ShareRepository } from '../repositories/shareRepository.js';
import type { AppEnv } from '../types.js';

const embed = new Hono<AppEnv>();

embed.get('/:shareId', async (c) => {
  try {
    const { showTitle, showDescription, fragmentIndex } = c.req.query();

    const repo = new ShareRepository(c.env.DB);
    const snippet = await repo.getShare(c.req.param('shareId'));
    if (!snippet) {
      return c.json({ error: 'Snippet not found' }, 404);
    }

    if (snippet.share.expired) {
      return c.json({ error: 'Share link has expired' }, 404);
    }

    if (snippet.share.requiresAuth) {
      const user = await resolveUser(c);
      if (!user) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    }

    const embedData = {
      id: snippet.id,
      title: showTitle === 'true' ? snippet.title : undefined,
      description: showDescription === 'true' ? snippet.description : undefined,
      fragments:
        fragmentIndex !== undefined
          ? [snippet.fragments[parseInt(fragmentIndex, 10)]]
          : snippet.fragments,
      updated_at: snippet.updated_at,
    };

    return c.json(embedData);
  } catch (error) {
    Logger.error('Error in embed route:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default embed;
