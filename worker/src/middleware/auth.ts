import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import Logger from '../logger.js';
import { UserRepository, type AccessProfile } from '../repositories/userRepository.js';
import { ApiKeyRepository } from '../repositories/apiKeyRepository.js';
import type { AppEnv, AuthUser } from '../types.js';

// JWKS fetchers cached per isolate (jose caches the keys internally too)
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

interface AccessJwtPayload extends JWTPayload {
  email?: string;
  name?: string;
  identity_nonce?: string;
  /** Access "common name" — set for service-token authentication instead of email */
  common_name?: string;
}

/**
 * Verify the Cloudflare Access JWT on the request, if any.
 *
 * Access injects `Cf-Access-Jwt-Assertion` on requests that passed an Access
 * policy. On Bypass paths (public shares/embeds) the header is absent, but a
 * browser that already authenticated elsewhere on the domain still sends the
 * CF_Authorization cookie, so we fall back to it — that is what lets
 * "requires auth" share links work on a bypassed path.
 */
export async function verifyAccessJwt(c: Context<AppEnv>): Promise<AccessJwtPayload | null> {
  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  if (!teamDomain) return null;

  const token = c.req.header('cf-access-jwt-assertion') ?? getCookie(c, 'CF_Authorization');
  if (!token) return null;

  try {
    const { payload } = await jwtVerify<AccessJwtPayload>(token, getJwks(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience: c.env.ACCESS_AUD || undefined,
    });
    return payload;
  } catch (error) {
    Logger.debug('Access JWT verification failed:', error);
    return null;
  }
}

export function isAdmin(c: Context<AppEnv>, username?: string | null): boolean {
  if (!username) return false;
  const adminUsernames = (c.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  return adminUsernames.includes(username.toLowerCase());
}

async function resolveAccessUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const claims = await verifyAccessJwt(c);
  if (!claims) return null;

  // Service-token authentication has no user identity; those clients must use
  // an API key (handled by authenticateApiKey / authenticateMcp).
  if (!claims.email) return null;

  const users = new UserRepository(c.env.DB);
  const profile: AccessProfile = {
    sub: (claims.sub as string) || claims.email,
    email: claims.email,
    name: claims.name ?? null,
  };
  const user = await users.findOrCreateAccessUser(profile);
  return user;
}

/** Dev-only fallback so `wrangler dev` works without a real Access tenant. */
async function resolveDevUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  if (c.env.DEV_AUTH !== 'true') return null;
  const users = new UserRepository(c.env.DB);
  return users.findOrCreateAccessUser({
    sub: 'dev-user',
    email: 'dev@localhost',
    name: 'Dev User',
    preferred_username: 'dev',
  });
}

/**
 * Resolve the current user, or null. Order matters:
 *  1. an API key middleware earlier in the chain already set the user
 *  2. DISABLE_ACCOUNTS maps everyone to the shared anonymous user
 *  3. Cloudflare Access JWT (header or CF_Authorization cookie)
 *  4. DEV_AUTH local-development fallback
 */
export async function resolveUser(c: Context<AppEnv>): Promise<AuthUser | null> {
  const existing = c.get('user');
  if (existing) return existing;

  if (c.env.DISABLE_ACCOUNTS === 'true') {
    const users = new UserRepository(c.env.DB);
    return users.getOrCreateAnonymousUser();
  }

  const accessUser = await resolveAccessUser(c);
  if (accessUser) return accessUser;

  return resolveDevUser(c);
}

/** Requires an authenticated user; 401 otherwise, 403 for deactivated accounts. */
export const authenticateUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  let user: AuthUser | null;
  try {
    user = await resolveUser(c);
  } catch (error) {
    Logger.error('Error resolving user:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }

  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  if (user.is_active === 0 || user.is_active === false) {
    return c.json({ error: 'Account has been deactivated' }, 403);
  }

  c.set('user', user);
  return next();
};

/**
 * Optional API-key authentication (x-api-key header), mirroring the original
 * middleware: absence of the header is not an error, an invalid key is.
 */
export const authenticateApiKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  const apiKey = c.req.header('x-api-key');
  if (!apiKey) return next();

  try {
    const result = await new ApiKeyRepository(c.env.DB).validateApiKey(apiKey);
    if (result) {
      c.set('user', { id: result.userId, username: '' });
      c.set('apiKey', { id: result.keyId });
      Logger.debug(`Request authenticated via API key ${result.keyId}`);
      return next();
    }

    Logger.info('Invalid API key provided');
    return c.json({ error: 'Invalid API key' }, 401);
  } catch (error) {
    Logger.error('Error validating API key:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ message: 'Authentication required' }, 401);
  }

  if (!isAdmin(c, user.username)) {
    Logger.debug(`Admin access denied for user: ${user.username}`);
    return c.json({ message: 'Admin access required' }, 403);
  }

  return next();
};

function extractMcpApiKey(c: Context<AppEnv>): string | null {
  const authHeader = c.req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const apiKeyHeader = c.req.header('x-api-key');
  if (apiKeyHeader) {
    return apiKeyHeader.trim();
  }

  return null;
}

/**
 * Authentication for the MCP endpoint: a ByteStash API key as
 * `Authorization: Bearer <key>` or `x-api-key`, with the same anonymous-user
 * fallback as the REST API when DISABLE_ACCOUNTS=true.
 */
export const authenticateMcp: MiddlewareHandler<AppEnv> = async (c, next) => {
  const unauthorized = (message: string) => {
    c.header('WWW-Authenticate', 'Bearer realm="ByteStash MCP", error="invalid_token"');
    return c.json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }, 401);
  };

  const apiKey = extractMcpApiKey(c);

  if (!apiKey) {
    if (c.env.DISABLE_ACCOUNTS === 'true') {
      try {
        const anonymousUser = await new UserRepository(c.env.DB).getOrCreateAnonymousUser();
        c.set('user', anonymousUser);
        return next();
      } catch (error) {
        Logger.error('Error in anonymous MCP authentication:', error);
        return c.json(
          { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
          500
        );
      }
    }

    return unauthorized(
      'Missing API key. Provide it as "Authorization: Bearer <key>" or the "x-api-key" header.'
    );
  }

  try {
    const result = await new ApiKeyRepository(c.env.DB).validateApiKey(apiKey);

    if (result) {
      c.set('user', { id: result.userId, username: '' });
      c.set('apiKey', { id: result.keyId });
      Logger.debug(`MCP request authenticated via API key ${result.keyId}`);
      return next();
    }

    Logger.info('Invalid API key provided to MCP endpoint');
    return unauthorized('Invalid API key');
  } catch (error) {
    Logger.error('Error validating API key for MCP:', error);
    return c.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
      500
    );
  }
};
