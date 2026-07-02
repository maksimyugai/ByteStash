import { Hono } from 'hono';
import Logger from '../logger.js';
import { authenticateUser, resolveUser } from '../middleware/auth.js';
import { ShareRepository } from '../repositories/shareRepository.js';
import type { AppEnv } from '../types.js';

const share = new Hono<AppEnv>();

share.post('/', authenticateUser, async (c) => {
  try {
    const { snippetId, requiresAuth, expiresIn } = await c.req.json();
    const repo = new ShareRepository(c.env.DB);
    const created = await repo.createShare(
      {
        snippetId,
        requiresAuth: !!requiresAuth,
        expiresIn: expiresIn ? parseInt(expiresIn) : null,
      },
      c.get('user').id
    );
    return c.json(created, 201);
  } catch (error) {
    Logger.error('Error creating share:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return c.json({ error: 'You do not have permission to share this snippet' }, 403);
    }
    if (error instanceof Error && error.message === 'Invalid snippet ID') {
      return c.json({ error: 'Invalid snippet ID provided' }, 400);
    }
    return c.json({ error: 'Failed to create share' }, 500);
  }
});

// Public path (Access Bypass). "Requires auth" shares are still enforced
// app-side: the viewer must present a valid Access identity (header or
// CF_Authorization cookie) or the instance must be in DISABLE_ACCOUNTS mode.
share.get('/:id', async (c) => {
  try {
    const repo = new ShareRepository(c.env.DB);
    const found = await repo.getShare(c.req.param('id'));

    if (!found) {
      return c.json({ error: 'Share not found' }, 404);
    }

    if (found.share?.requiresAuth) {
      const user = await resolveUser(c);
      if (!user) {
        return c.json({ error: 'Authentication required' }, 401);
      }
    }

    if (found.share?.expired) {
      return c.json({ error: 'Share has expired' }, 410);
    }

    return c.json(found);
  } catch (error) {
    Logger.error('Error getting share:', error);
    return c.json({ error: 'Failed to get share' }, 500);
  }
});

share.get('/snippet/:snippetId', authenticateUser, async (c) => {
  try {
    const repo = new ShareRepository(c.env.DB);
    const shares = await repo.getSharesBySnippetId(c.req.param('snippetId'), c.get('user').id);
    return c.json(shares);
  } catch (error) {
    Logger.error('Error listing shares:', error);
    return c.json({ error: 'Failed to list shares' }, 500);
  }
});

share.delete('/:id', authenticateUser, async (c) => {
  try {
    const repo = new ShareRepository(c.env.DB);
    await repo.deleteShare(c.req.param('id'), c.get('user').id);
    return c.json({ success: true });
  } catch (error) {
    Logger.error('Error deleting share:', error);
    return c.json({ error: 'Failed to delete share' }, 500);
  }
});

export default share;
