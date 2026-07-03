import Logger from '../logger.js';
import type { AuthUser } from '../types.js';

export const ACCESS_PROVIDER = 'cloudflare-access';

export interface AccessProfile {
  /** Stable subject from the Access JWT (user UUID) or the email as fallback */
  sub: string;
  email?: string | null;
  name?: string | null;
  preferred_username?: string | null;
}

export class UserRepository {
  constructor(private db: D1Database) {}

  async findById(id: number): Promise<AuthUser | null> {
    return this.db
      .prepare(
        `SELECT id, username, created_at, email, name, oidc_id, is_admin, is_active
         FROM users WHERE id = ?`
      )
      .bind(id)
      .first<AuthUser>();
  }

  async findByUsername(username: string): Promise<AuthUser | null> {
    return this.db
      .prepare(
        `SELECT id, username, created_at, email, name, oidc_id, oidc_provider, is_admin, is_active
         FROM users WHERE username_normalized = ? COLLATE NOCASE`
      )
      .bind(username.toLowerCase())
      .first<AuthUser>();
  }

  async countUsers(): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) as count FROM users')
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  private async generateUniqueUsername(baseUsername: string): Promise<string> {
    let username = baseUsername;
    let counter = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const row = await this.db
        .prepare('SELECT COUNT(*) as count FROM users WHERE username_normalized = ? COLLATE NOCASE')
        .bind(username.toLowerCase())
        .first<{ count: number }>();
      if (!row || row.count === 0) return username;
      username = `${baseUsername}${counter}`;
      counter++;
    }
  }

  /**
   * Imported (pre-Access) accounts can list several addresses in the email
   * column, comma-separated. A login with any of them claims the account, so
   * migrated users land in their old account instead of a freshly provisioned
   * empty one. The email is trusted because it comes from a validated Access
   * JWT and the column is only ever set by us.
   */
  private async findByAccessEmail(email: string): Promise<AuthUser | null> {
    return this.db
      .prepare(
        `SELECT id, username, created_at, email, name, oidc_id, is_admin, is_active
         FROM users
         WHERE email IS NOT NULL
           AND (',' || LOWER(REPLACE(email, ' ', '')) || ',') LIKE ('%,' || LOWER(?) || ',%')`
      )
      .bind(email)
      .first<AuthUser>();
  }

  /**
   * Find or auto-provision the user identified by a Cloudflare Access JWT.
   * Reuses the oidc_id/oidc_provider columns so no schema change is needed
   * and existing OIDC users keep working if their IdP subject is stable.
   */
  async findOrCreateAccessUser(profile: AccessProfile): Promise<AuthUser> {
    try {
      const existing = await this.db
        .prepare(
          `SELECT id, username, created_at, email, name, is_admin, is_active
           FROM users WHERE oidc_id = ? AND oidc_provider = ?`
        )
        .bind(profile.sub, ACCESS_PROVIDER)
        .first<AuthUser>();
      if (existing) return existing;

      if (profile.email) {
        const byEmail = await this.findByAccessEmail(profile.email);
        if (byEmail) {
          if (!byEmail.oidc_id) {
            // First Access login for a migrated account — link the identity
            await this.db
              .prepare('UPDATE users SET oidc_id = ?, oidc_provider = ? WHERE id = ?')
              .bind(profile.sub, ACCESS_PROVIDER, byEmail.id)
              .run();
            Logger.info(`Linked Access identity to existing user "${byEmail.username}"`);
          }
          // Already linked (e.g. the account lists several emails and this is
          // a secondary one) — keep the original link, it's the same person.
          return byEmail;
        }
      }

      const sanitizeName = (name: string) =>
        name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 30);

      const baseUsername = profile.preferred_username
        ? sanitizeName(profile.preferred_username)
        : profile.email?.split('@')[0] || (profile.name ? sanitizeName(profile.name) : profile.sub);

      const username = await this.generateUniqueUsername(baseUsername);

      const created = await this.db
        .prepare(
          `INSERT INTO users (username, username_normalized, password_hash, oidc_id, oidc_provider, email, name)
           VALUES (?, ?, '', ?, ?, ?, ?)
           RETURNING id, username, created_at, email, name, is_admin, is_active`
        )
        .bind(
          username,
          username.toLowerCase(),
          profile.sub,
          ACCESS_PROVIDER,
          profile.email ?? null,
          profile.name ?? null
        )
        .first<AuthUser>();

      if (!created) throw new Error('Failed to create user');
      Logger.info(`Provisioned user "${created.username}" from Cloudflare Access`);
      return created;
    } catch (error) {
      Logger.error('Error in findOrCreateAccessUser:', error);
      throw error;
    }
  }

  /** Shared user (id 0) used when DISABLE_ACCOUNTS=true. */
  async getOrCreateAnonymousUser(): Promise<AuthUser> {
    const existing = await this.findById(0);
    if (existing) return existing;

    const username = `anon-${generateHex(8)}`;
    await this.db
      .prepare(
        `INSERT INTO users (id, username, username_normalized, password_hash, created_at)
         VALUES (0, ?, ?, '', datetime('now'))
         ON CONFLICT(id) DO NOTHING`
      )
      .bind(username, username.toLowerCase())
      .run();

    return { id: 0, username, created_at: new Date().toISOString() };
  }

  async updateLastLogin(userId: number): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(userId)
        .run();
    } catch (error) {
      Logger.error('Error updating last login:', error);
    }
  }
}

export function generateHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
