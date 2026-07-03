import { Hono } from 'hono';
import Logger from '../logger.js';
import { isAdmin, resolveUser } from '../middleware/auth.js';
import { UserRepository } from '../repositories/userRepository.js';
import type { AppEnv } from '../types.js';

/*
 * Authentication is external (Cloudflare Access) — there are no passwords,
 * registration or internal login anymore. The client calls:
 *   GET /config  — feature flags for the UI
 *   GET /verify  — resolves the current user from the Access JWT (or the
 *                  anonymous user when DISABLE_ACCOUNTS=true) and
 *                  auto-provisions it on first sight
 */
const auth = new Hono<AppEnv>();

auth.get('/config', async (c) => {
  try {
    const users = new UserRepository(c.env.DB);
    const hasUsers = (await users.countUsers()) > 0;

    return c.json({
      authRequired: true,
      externalAuth: c.env.DISABLE_ACCOUNTS !== 'true',
      externalLogoutUrl: c.env.ACCESS_TEAM_DOMAIN
        ? `https://${c.env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout`
        : undefined,
      allowNewAccounts: false,
      hasUsers,
      disableAccounts: c.env.DISABLE_ACCOUNTS === 'true',
      disableInternalAccounts: true,
      allowPasswordChanges: false,
    });
  } catch (error) {
    Logger.error('Error getting auth config:', error);
    return c.json({ error: 'Failed to get auth configuration' }, 500);
  }
});

auth.get('/verify', async (c) => {
  try {
    const user = await resolveUser(c);

    if (!user || user.is_active === 0 || user.is_active === false) {
      return c.json({ valid: false }, 401);
    }

    const users = new UserRepository(c.env.DB);
    c.executionCtx.waitUntil(users.updateLastLogin(user.id));

    return c.json({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        is_admin: isAdmin(c, user.username),
      },
    });
  } catch (error) {
    Logger.error('Error verifying user:', error);
    return c.json({ valid: false }, 401);
  }
});

// Kept for client compatibility with DISABLE_ACCOUNTS mode: the anonymous
// "session" needs no token, the server maps every request to user id 0.
auth.post('/anonymous', async (c) => {
  if (c.env.DISABLE_ACCOUNTS !== 'true') {
    return c.json({ error: 'Anonymous login not allowed' }, 403);
  }

  try {
    const users = new UserRepository(c.env.DB);
    const anonymousUser = await users.getOrCreateAnonymousUser();
    return c.json({ token: 'anonymous', user: anonymousUser });
  } catch (error) {
    Logger.error('Error in anonymous login:', error);
    return c.json({ error: 'Failed to create anonymous session' }, 500);
  }
});

export default auth;
