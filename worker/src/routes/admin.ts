import { Hono } from 'hono';
import Logger from '../logger.js';
import { AdminRepository } from '../repositories/adminRepository.js';
import badWordsChecker from '../utils/badWords.js';
import type { AppEnv } from '../types.js';

const admin = new Hono<AppEnv>();

// Dashboard stats
admin.get('/stats', async (c) => {
  try {
    const stats = await new AdminRepository(c.env.DB).getStats();
    return c.json(stats);
  } catch (error) {
    Logger.error('Error getting admin stats:', error);
    return c.json({ message: 'Failed to retrieve statistics' }, 500);
  }
});

// User management
admin.get('/users', async (c) => {
  try {
    const { offset = '0', limit = '50', search = '', authType = '', isActive = '' } = c.req.query();
    const result = await new AdminRepository(c.env.DB).getAllUsers({
      offset: parseInt(offset),
      limit: parseInt(limit),
      search,
      authType,
      isActive,
    });
    return c.json(result);
  } catch (error) {
    Logger.error('Error getting users:', error);
    return c.json({ message: 'Failed to retrieve users' }, 500);
  }
});

admin.get('/users/:id', async (c) => {
  try {
    const user = await new AdminRepository(c.env.DB).getUserDetails(c.req.param('id'));
    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }
    return c.json(user);
  } catch (error) {
    Logger.error('Error getting user details:', error);
    return c.json({ message: 'Failed to retrieve user details' }, 500);
  }
});

admin.delete('/users/:id', async (c) => {
  try {
    const userId = parseInt(c.req.param('id'));

    if (userId === c.get('user').id) {
      return c.json({ message: 'Cannot delete your own account' }, 400);
    }

    if (userId === 0) {
      return c.json({ message: 'Cannot delete anonymous user' }, 400);
    }

    const deleted = await new AdminRepository(c.env.DB).deleteUser(userId);
    if (!deleted) {
      return c.json({ message: 'User not found' }, 404);
    }

    return c.json({ message: 'User deleted successfully' });
  } catch (error) {
    Logger.error('Error deleting user:', error);
    return c.json({ message: 'Failed to delete user' }, 500);
  }
});

admin.patch('/users/:id/toggle-active', async (c) => {
  try {
    const userId = parseInt(c.req.param('id'));

    if (userId === c.get('user').id) {
      return c.json({ message: 'Cannot modify your own active status' }, 400);
    }

    if (userId === 0) {
      return c.json({ message: 'Cannot modify anonymous user' }, 400);
    }

    const user = await new AdminRepository(c.env.DB).toggleUserActive(userId);
    return c.json(user);
  } catch (error) {
    Logger.error('Error toggling user active status:', error);
    return c.json({ message: 'Failed to update user status' }, 500);
  }
});

// Snippet management
admin.get('/snippets', async (c) => {
  try {
    const {
      offset = '0',
      limit = '50',
      search = '',
      userId = '',
      isPublic = '',
      language = '',
      category = '',
    } = c.req.query();
    const result = await new AdminRepository(c.env.DB).getAllSnippets({
      offset: parseInt(offset),
      limit: parseInt(limit),
      search,
      userId,
      isPublic,
      language,
      category,
    });
    return c.json(result);
  } catch (error) {
    Logger.error('Error getting snippets:', error);
    return c.json({ message: 'Failed to retrieve snippets' }, 500);
  }
});

admin.delete('/snippets/:id', async (c) => {
  try {
    const deleted = await new AdminRepository(c.env.DB).deleteSnippetPermanently(
      c.req.param('id')
    );
    if (!deleted) {
      return c.json({ message: 'Snippet not found' }, 404);
    }
    return c.json({ message: 'Snippet deleted successfully' });
  } catch (error) {
    Logger.error('Error deleting snippet:', error);
    return c.json({ message: 'Failed to delete snippet' }, 500);
  }
});

admin.patch('/snippets/:id/owner', async (c) => {
  try {
    const { newUserId } = await c.req.json();

    if (!newUserId) {
      return c.json({ message: 'newUserId is required' }, 400);
    }

    await new AdminRepository(c.env.DB).changeSnippetOwner(c.req.param('id'), newUserId);
    return c.json({ message: 'Snippet owner changed successfully' });
  } catch (error) {
    Logger.error('Error changing snippet owner:', error);
    return c.json({ message: 'Failed to change snippet owner' }, 500);
  }
});

admin.patch('/snippets/:id/toggle-public', async (c) => {
  try {
    await new AdminRepository(c.env.DB).toggleSnippetPublic(c.req.param('id'));
    return c.json({ message: 'Snippet visibility toggled successfully' });
  } catch (error) {
    Logger.error('Error toggling snippet public status:', error);
    return c.json({ message: 'Failed to toggle snippet visibility' }, 500);
  }
});

admin.get('/snippets/scan/offensive', async (c) => {
  try {
    const result = await new AdminRepository(c.env.DB).scanSnippetsForOffensiveContent(
      badWordsChecker
    );
    return c.json(result);
  } catch (error) {
    Logger.error('Error scanning snippets for offensive content:', error);
    return c.json({ message: 'Failed to scan snippets for offensive content' }, 500);
  }
});

admin.get('/snippets/:id', async (c) => {
  try {
    const snippet = await new AdminRepository(c.env.DB).getSnippetDetails(c.req.param('id'));
    if (!snippet) {
      return c.json({ message: 'Snippet not found' }, 404);
    }
    return c.json(snippet);
  } catch (error) {
    Logger.error('Error getting snippet details:', error);
    return c.json({ message: 'Failed to retrieve snippet details' }, 500);
  }
});

// API Key management
admin.get('/api-keys', async (c) => {
  try {
    const { offset = '0', limit = '50', userId = '' } = c.req.query();
    const result = await new AdminRepository(c.env.DB).getAllApiKeys({
      offset: parseInt(offset),
      limit: parseInt(limit),
      userId,
    });
    return c.json(result);
  } catch (error) {
    Logger.error('Error getting API keys:', error);
    return c.json({ message: 'Failed to retrieve API keys' }, 500);
  }
});

admin.delete('/api-keys/:id', async (c) => {
  try {
    const deleted = await new AdminRepository(c.env.DB).deleteApiKey(c.req.param('id'));
    if (!deleted) {
      return c.json({ message: 'API key not found' }, 404);
    }
    return c.json({ message: 'API key deleted successfully' });
  } catch (error) {
    Logger.error('Error deleting API key:', error);
    return c.json({ message: 'Failed to delete API key' }, 500);
  }
});

// Share management
admin.get('/shares', async (c) => {
  try {
    const { offset = '0', limit = '50', userId = '', requiresAuth = '' } = c.req.query();
    const result = await new AdminRepository(c.env.DB).getAllShares({
      offset: parseInt(offset),
      limit: parseInt(limit),
      userId,
      requiresAuth,
    });
    return c.json(result);
  } catch (error) {
    Logger.error('Error getting shares:', error);
    return c.json({ message: 'Failed to retrieve shares' }, 500);
  }
});

admin.delete('/shares/:id', async (c) => {
  try {
    const deleted = await new AdminRepository(c.env.DB).deleteShare(c.req.param('id'));
    if (!deleted) {
      return c.json({ message: 'Share not found' }, 404);
    }
    return c.json({ message: 'Share deleted successfully' });
  } catch (error) {
    Logger.error('Error deleting share:', error);
    return c.json({ message: 'Failed to delete share' }, 500);
  }
});

export default admin;
