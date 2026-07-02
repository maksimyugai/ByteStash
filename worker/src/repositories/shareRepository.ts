import Logger from '../logger.js';
import { generateHex } from './userRepository.js';
import type { Fragment } from '../types.js';

interface ShareRow {
  share_id: string;
  requires_auth: number;
  expires_at: string | null;
  created_at: string;
  expired: number;
  id: number;
  title: string;
  description: string | null;
  user_id: number;
  updated_at: string;
  categories: string | null;
}

export interface Share {
  id: number;
  title: string;
  description: string | null;
  updated_at: string;
  categories: string[];
  fragments: Fragment[];
  share: {
    id: string;
    requiresAuth: boolean;
    expiresAt: string | null;
    createdAt: string;
    expired: boolean;
  };
}

export class ShareRepository {
  constructor(private db: D1Database) {}

  async createShare(
    {
      snippetId,
      requiresAuth,
      expiresIn,
    }: { snippetId: number | string; requiresAuth: boolean; expiresIn: number | null },
    userId: number
  ) {
    const snippetIdInt = parseInt(String(snippetId), 10);
    if (isNaN(snippetIdInt)) {
      throw new Error('Invalid snippet ID');
    }

    const owner = await this.db
      .prepare('SELECT user_id FROM snippets WHERE id = ?')
      .bind(snippetIdInt)
      .first<{ user_id: number }>();
    if (!owner || owner.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    const shareId = generateHex(16);

    try {
      await this.db
        .prepare(
          `INSERT INTO shared_snippets (id, snippet_id, requires_auth, expires_at)
           VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'))`
        )
        .bind(shareId, snippetIdInt, requiresAuth ? 1 : 0, expiresIn)
        .run();

      return { id: shareId, snippetId: snippetIdInt, requiresAuth, expiresIn };
    } catch (error) {
      Logger.error('Error in createShare:', error);
      throw error;
    }
  }

  async getShare(id: string): Promise<Share | null> {
    try {
      const share = await this.db
        .prepare(
          `SELECT
             ss.id as share_id,
             ss.requires_auth,
             ss.expires_at,
             ss.created_at,
             datetime(ss.expires_at) < datetime('now') as expired,
             s.id,
             s.title,
             s.description,
             s.user_id,
             datetime(s.updated_at) || 'Z' as updated_at,
             GROUP_CONCAT(DISTINCT c.name) as categories
           FROM shared_snippets ss
           JOIN snippets s ON s.id = ss.snippet_id
           LEFT JOIN categories c ON s.id = c.snippet_id
           WHERE ss.id = ? AND s.expiry_date IS NULL
           GROUP BY s.id`
        )
        .bind(id)
        .first<ShareRow>();

      if (!share) return null;

      const { results: fragments } = await this.db
        .prepare(
          `SELECT id, file_name, code, language, position
           FROM fragments WHERE snippet_id = ? ORDER BY position`
        )
        .bind(share.id)
        .all<Fragment>();

      return {
        id: share.id,
        title: share.title,
        description: share.description,
        updated_at: share.updated_at,
        categories: share.categories ? share.categories.split(',') : [],
        fragments,
        share: {
          id: share.share_id,
          requiresAuth: !!share.requires_auth,
          expiresAt: share.expires_at,
          createdAt: share.created_at,
          expired: !!share.expired,
        },
      };
    } catch (error) {
      Logger.error('Error in getShare:', error);
      throw error;
    }
  }

  async getSharesBySnippetId(snippetId: number | string, userId: number) {
    const snippetIdInt = parseInt(String(snippetId), 10);
    if (isNaN(snippetIdInt)) {
      throw new Error('Invalid snippet ID');
    }

    try {
      const { results } = await this.db
        .prepare(
          `SELECT
             ss.*,
             datetime(ss.expires_at) < datetime('now') as expired
           FROM shared_snippets ss
           JOIN snippets s ON s.id = ss.snippet_id
           WHERE ss.snippet_id = ? AND s.user_id = ? AND s.expiry_date IS NULL
           ORDER BY ss.created_at DESC`
        )
        .bind(snippetIdInt, userId)
        .all();
      return results;
    } catch (error) {
      Logger.error('Error in getSharesBySnippetId:', error);
      throw error;
    }
  }

  async deleteShare(id: string, userId: number) {
    try {
      return await this.db
        .prepare(
          `DELETE FROM shared_snippets
           WHERE id = ?
           AND snippet_id IN (SELECT id FROM snippets WHERE user_id = ?)`
        )
        .bind(id, userId)
        .run();
    } catch (error) {
      Logger.error('Error in deleteShare:', error);
      throw error;
    }
  }

  /** Delete shares whose expiry has passed. Returns deleted count. */
  async deleteExpiredShares(): Promise<number> {
    try {
      const result = await this.db
        .prepare(
          `DELETE FROM shared_snippets
           WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`
        )
        .run();
      return result.meta.changes ?? 0;
    } catch (error) {
      Logger.error('Error in deleteExpiredShares:', error);
      throw error;
    }
  }
}
