import { Hono } from 'hono';
import Logger from '../logger.js';
import { ApiKeyRepository } from '../repositories/apiKeyRepository.js';
import type { AppEnv } from '../types.js';

const apiKeys = new Hono<AppEnv>();

// List all API keys for the authenticated user
apiKeys.get('/', async (c) => {
  try {
    const repo = new ApiKeyRepository(c.env.DB);
    const keys = await repo.getApiKeys(c.get('user').id);
    return c.json(keys);
  } catch (error) {
    Logger.error('Error fetching API keys:', error);
    return c.json({ error: 'Failed to fetch API keys' }, 500);
  }
});

apiKeys.post('/', async (c) => {
  try {
    const { name } = await c.req.json();

    if (!name) {
      return c.json({ error: 'Name is required' }, 400);
    }

    const repo = new ApiKeyRepository(c.env.DB);
    const apiKey = await repo.createApiKey(c.get('user').id, name);

    if (!apiKey) {
      return c.json({ error: 'Failed to create API key' }, 500);
    }

    Logger.debug(`User ${c.get('user').id} created new API key`);
    return c.json(apiKey, 201);
  } catch (error) {
    Logger.error('Error creating API key:', error);
    return c.json({ error: 'Failed to create API key' }, 500);
  }
});

apiKeys.delete('/:id', async (c) => {
  try {
    const repo = new ApiKeyRepository(c.env.DB);
    const success = await repo.deleteApiKey(c.get('user').id, c.req.param('id'));

    if (!success) {
      return c.json({ error: 'API key not found' }, 404);
    }

    Logger.debug(`User ${c.get('user').id} deleted API key ${c.req.param('id')}`);
    return c.json({ sucess: success });
  } catch (error) {
    Logger.error('Error deleting API key:', error);
    return c.json({ error: 'Failed to delete API key' }, 500);
  }
});

export default apiKeys;
