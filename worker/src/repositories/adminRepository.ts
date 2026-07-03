import Logger from '../logger.js';
import type { Fragment } from '../types.js';

interface BadWordsChecker {
  findBadWords(text: string): string[];
}

export class AdminRepository {
  constructor(private db: D1Database) {}

  async getStats() {
    try {
      const [users, internal, oidc, snippets, publicSnippets, apiKeys, shares] =
        await this.db.batch([
          this.db.prepare('SELECT COUNT(*) as count FROM users WHERE id != 0'),
          this.db.prepare('SELECT COUNT(*) as count FROM users WHERE id != 0 AND oidc_id IS NULL'),
          this.db.prepare(
            'SELECT COUNT(*) as count FROM users WHERE id != 0 AND oidc_id IS NOT NULL'
          ),
          this.db.prepare('SELECT COUNT(*) as count FROM snippets'),
          this.db.prepare('SELECT COUNT(*) as count FROM snippets WHERE is_public = 1'),
          this.db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1'),
          this.db.prepare('SELECT COUNT(*) as count FROM shared_snippets'),
        ]);

      const count = (res: D1Result) => (res.results as { count: number }[])[0]?.count ?? 0;
      const totalSnippets = count(snippets);
      const publicCount = count(publicSnippets);

      return {
        users: { total: count(users), internal: count(internal), oidc: count(oidc) },
        snippets: {
          total: totalSnippets,
          public: publicCount,
          private: totalSnippets - publicCount,
        },
        apiKeys: { active: count(apiKeys) },
        shares: { total: count(shares) },
      };
    } catch (error) {
      Logger.error('Error getting admin stats:', error);
      throw error;
    }
  }

  async getAllUsers({
    offset = 0,
    limit = 50,
    search = '',
    authType = '',
    isActive = '',
  }: {
    offset?: number;
    limit?: number;
    search?: string;
    authType?: string;
    isActive?: string;
  }) {
    try {
      let where = ' WHERE u.id != 0';
      const params: unknown[] = [];

      if (search) {
        where += ' AND (u.username LIKE ? OR u.email LIKE ? OR u.name LIKE ?)';
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern);
      }

      if (authType === 'internal') {
        where += ' AND u.oidc_id IS NULL';
      } else if (authType === 'oidc') {
        where += ' AND u.oidc_id IS NOT NULL';
      }

      if (isActive !== '') {
        where += ' AND u.is_active = ?';
        params.push(isActive === 'true' ? 1 : 0);
      }

      const [usersRes, countRes] = await this.db.batch([
        this.db
          .prepare(
            `SELECT
               u.id, u.username, u.email, u.name, u.created_at, u.last_login_at,
               u.oidc_id, u.oidc_provider, u.is_admin, u.is_active,
               (SELECT COUNT(*) FROM snippets WHERE user_id = u.id) as snippet_count,
               (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id) as api_key_count
             FROM users u${where}
             ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
          )
          .bind(...params, limit, offset),
        this.db.prepare(`SELECT COUNT(*) as count FROM users u${where}`).bind(...params),
      ]);

      return {
        users: usersRes.results,
        total: (countRes.results as { count: number }[])[0]?.count ?? 0,
      };
    } catch (error) {
      Logger.error('Error getting all users:', error);
      throw error;
    }
  }

  async getUserDetails(userId: number | string) {
    try {
      const user = await this.db
        .prepare(
          `SELECT id, username, email, name, created_at,
                  oidc_id, oidc_provider, is_admin, is_active, last_login_at
           FROM users WHERE id = ?`
        )
        .bind(userId)
        .first();
      if (!user) return null;

      const [snippetRes, apiKeyRes] = await this.db.batch([
        this.db.prepare('SELECT COUNT(*) as count FROM snippets WHERE user_id = ?').bind(userId),
        this.db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?').bind(userId),
      ]);

      return {
        ...user,
        snippet_count: (snippetRes.results as { count: number }[])[0]?.count ?? 0,
        api_key_count: (apiKeyRes.results as { count: number }[])[0]?.count ?? 0,
      };
    } catch (error) {
      Logger.error('Error getting user details:', error);
      throw error;
    }
  }

  async deleteUser(userId: number): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('DELETE FROM users WHERE id = ? AND id != 0')
        .bind(userId)
        .run();
      return (result.meta.changes ?? 0) > 0;
    } catch (error) {
      Logger.error('Error deleting user:', error);
      throw error;
    }
  }

  async toggleUserActive(userId: number) {
    try {
      const result = await this.db
        .prepare('UPDATE users SET is_active = NOT is_active WHERE id = ? AND id != 0')
        .bind(userId)
        .run();
      if ((result.meta.changes ?? 0) === 0) {
        throw new Error('User not found or cannot be modified');
      }
      return this.getUserDetails(userId);
    } catch (error) {
      Logger.error('Error toggling user active status:', error);
      throw error;
    }
  }

  async getAllSnippets({
    offset = 0,
    limit = 50,
    search = '',
    userId = '',
    isPublic = '',
    language = '',
    category = '',
  }: {
    offset?: number;
    limit?: number;
    search?: string;
    userId?: string;
    isPublic?: string;
    language?: string;
    category?: string;
  }) {
    try {
      let where = ' WHERE 1=1';
      const params: unknown[] = [];

      if (search) {
        where += ' AND (s.title LIKE ? OR s.description LIKE ?)';
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern);
      }

      if (userId) {
        where += ' AND s.user_id = ?';
        params.push(userId);
      }

      if (isPublic !== '') {
        where += ' AND s.is_public = ?';
        params.push(isPublic === 'true' ? 1 : 0);
      }

      if (language) {
        where += ' AND s.id IN (SELECT snippet_id FROM fragments WHERE language = ?)';
        params.push(language);
      }

      if (category) {
        where += ' AND s.id IN (SELECT snippet_id FROM categories WHERE name = ?)';
        params.push(category);
      }

      const [snippetsRes, countRes] = await this.db.batch([
        this.db
          .prepare(
            `SELECT
               s.id, s.title, s.description, s.updated_at, s.is_public,
               s.user_id, u.username,
               (SELECT COUNT(*) FROM fragments WHERE snippet_id = s.id) as fragment_count
             FROM snippets s
             LEFT JOIN users u ON s.user_id = u.id${where}
             ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`
          )
          .bind(...params, limit, offset),
        this.db.prepare(`SELECT COUNT(*) as count FROM snippets s${where}`).bind(...params),
      ]);

      return {
        snippets: snippetsRes.results,
        total: (countRes.results as { count: number }[])[0]?.count ?? 0,
      };
    } catch (error) {
      Logger.error('Error getting all snippets:', error);
      throw error;
    }
  }

  async deleteSnippetPermanently(snippetId: number | string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('DELETE FROM snippets WHERE id = ?')
        .bind(snippetId)
        .run();
      return (result.meta.changes ?? 0) > 0;
    } catch (error) {
      Logger.error('Error deleting snippet:', error);
      throw error;
    }
  }

  async changeSnippetOwner(snippetId: number | string, newUserId: number): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('UPDATE snippets SET user_id = ? WHERE id = ?')
        .bind(newUserId, snippetId)
        .run();
      if ((result.meta.changes ?? 0) === 0) {
        throw new Error('Snippet not found');
      }
      return true;
    } catch (error) {
      Logger.error('Error changing snippet owner:', error);
      throw error;
    }
  }

  async toggleSnippetPublic(snippetId: number | string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('UPDATE snippets SET is_public = NOT is_public WHERE id = ?')
        .bind(snippetId)
        .run();
      if ((result.meta.changes ?? 0) === 0) {
        throw new Error('Snippet not found');
      }
      return true;
    } catch (error) {
      Logger.error('Error toggling snippet public status:', error);
      throw error;
    }
  }

  async getAllApiKeys({
    offset = 0,
    limit = 50,
    userId = '',
  }: {
    offset?: number;
    limit?: number;
    userId?: string;
  }) {
    try {
      let where = ' WHERE 1=1';
      const params: unknown[] = [];

      if (userId) {
        where += ' AND ak.user_id = ?';
        params.push(userId);
      }

      const [keysRes, countRes] = await this.db.batch([
        this.db
          .prepare(
            `SELECT
               ak.id, ak.name, ak.created_at, ak.last_used_at, ak.is_active,
               ak.user_id, u.username
             FROM api_keys ak
             LEFT JOIN users u ON ak.user_id = u.id${where}
             ORDER BY ak.created_at DESC LIMIT ? OFFSET ?`
          )
          .bind(...params, limit, offset),
        this.db
          .prepare(`SELECT COUNT(*) as count FROM api_keys ak${where}`)
          .bind(...params),
      ]);

      return {
        apiKeys: keysRes.results,
        total: (countRes.results as { count: number }[])[0]?.count ?? 0,
      };
    } catch (error) {
      Logger.error('Error getting all API keys:', error);
      throw error;
    }
  }

  async deleteApiKey(keyId: number | string): Promise<boolean> {
    try {
      const result = await this.db.prepare('DELETE FROM api_keys WHERE id = ?').bind(keyId).run();
      return (result.meta.changes ?? 0) > 0;
    } catch (error) {
      Logger.error('Error deleting API key:', error);
      throw error;
    }
  }

  async getAllShares({
    offset = 0,
    limit = 50,
    userId = '',
    requiresAuth = '',
  }: {
    offset?: number;
    limit?: number;
    userId?: string;
    requiresAuth?: string;
  }) {
    try {
      let where = ' WHERE 1=1';
      const params: unknown[] = [];

      if (userId) {
        where += ' AND s.user_id = ?';
        params.push(userId);
      }

      if (requiresAuth !== '') {
        where += ' AND ss.requires_auth = ?';
        params.push(requiresAuth === 'true' ? 1 : 0);
      }

      const [sharesRes, countRes] = await this.db.batch([
        this.db
          .prepare(
            `SELECT
               ss.id, ss.requires_auth, ss.expires_at, ss.created_at,
               ss.snippet_id, s.title as snippet_title,
               s.user_id, u.username
             FROM shared_snippets ss
             LEFT JOIN snippets s ON ss.snippet_id = s.id
             LEFT JOIN users u ON s.user_id = u.id${where}
             ORDER BY ss.created_at DESC LIMIT ? OFFSET ?`
          )
          .bind(...params, limit, offset),
        this.db
          .prepare(
            `SELECT COUNT(*) as count
             FROM shared_snippets ss
             LEFT JOIN snippets s ON ss.snippet_id = s.id${where}`
          )
          .bind(...params),
      ]);

      return {
        shares: sharesRes.results,
        total: (countRes.results as { count: number }[])[0]?.count ?? 0,
      };
    } catch (error) {
      Logger.error('Error getting all shares:', error);
      throw error;
    }
  }

  async deleteShare(shareId: string): Promise<boolean> {
    try {
      const result = await this.db
        .prepare('DELETE FROM shared_snippets WHERE id = ?')
        .bind(shareId)
        .run();
      return (result.meta.changes ?? 0) > 0;
    } catch (error) {
      Logger.error('Error deleting share:', error);
      throw error;
    }
  }

  async scanSnippetsForOffensiveContent(badWordsChecker: BadWordsChecker) {
    try {
      const { results: snippets } = await this.db
        .prepare(
          `SELECT
             s.id, s.title, s.description, s.updated_at, s.is_public,
             s.user_id, u.username,
             COUNT(DISTINCT f.id) as fragment_count,
             GROUP_CONCAT(f.code || ' ' || f.file_name, '|||') as fragments_content
           FROM snippets s
           LEFT JOIN users u ON s.user_id = u.id
           LEFT JOIN fragments f ON s.id = f.snippet_id
           GROUP BY s.id
           ORDER BY s.updated_at DESC`
        )
        .all<{
          id: number;
          title: string;
          description: string | null;
          updated_at: string;
          is_public: number;
          user_id: number;
          username: string | null;
          fragment_count: number;
          fragments_content: string | null;
        }>();

      const flaggedSnippets = [];

      for (const snippet of snippets) {
        const textToCheck = [
          snippet.title || '',
          snippet.description || '',
          snippet.fragments_content || '',
        ].join(' ');

        const foundWords = badWordsChecker.findBadWords(textToCheck);

        if (foundWords.length > 0) {
          flaggedSnippets.push({
            id: snippet.id,
            title: snippet.title,
            description: snippet.description,
            updated_at: snippet.updated_at,
            is_public: snippet.is_public,
            user_id: snippet.user_id,
            username: snippet.username,
            fragment_count: snippet.fragment_count,
            flagged_words: foundWords,
          });
        }
      }

      return { snippets: flaggedSnippets, total: flaggedSnippets.length };
    } catch (error) {
      Logger.error('Error scanning snippets for offensive content:', error);
      throw error;
    }
  }

  async getSnippetDetails(snippetId: number | string) {
    try {
      const snippet = await this.db
        .prepare(
          `SELECT
             s.id,
             s.title,
             s.description,
             datetime(s.updated_at) || 'Z' as updated_at,
             s.user_id,
             s.is_public,
             s.is_pinned,
             s.is_favorite,
             u.username,
             GROUP_CONCAT(DISTINCT c.name) as categories,
             (SELECT COUNT(*) FROM shared_snippets WHERE snippet_id = s.id) as share_count
           FROM snippets s
           LEFT JOIN categories c ON s.id = c.snippet_id
           LEFT JOIN users u ON s.user_id = u.id
           WHERE s.id = ?
           GROUP BY s.id`
        )
        .bind(snippetId)
        .first<{ categories: string | null; share_count: number } & Record<string, unknown>>();

      if (!snippet) return null;

      const { results: fragments } = await this.db
        .prepare(
          `SELECT id, file_name, code, language, position
           FROM fragments WHERE snippet_id = ? ORDER BY position`
        )
        .bind(snippetId)
        .all<Fragment>();

      return {
        ...snippet,
        categories: snippet.categories ? snippet.categories.split(',') : [],
        fragments,
        share_count: snippet.share_count || 0,
      };
    } catch (error) {
      Logger.error('Error getting snippet details:', error);
      throw error;
    }
  }
}
