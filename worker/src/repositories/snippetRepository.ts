import Logger from '../logger.js';
import type { Fragment, SnippetFilters, SnippetInput } from '../types.js';

export interface SnippetRow {
  id: number;
  title: string;
  description: string | null;
  updated_at: string;
  expiry_date?: string | null;
  user_id: number;
  is_public: number;
  is_pinned: number;
  is_favorite: number;
  username?: string | null;
  categories: string | null;
  share_count: number;
  total_count?: number;
}

export interface Snippet extends Omit<SnippetRow, 'categories'> {
  categories: string[];
  fragments: Fragment[];
}

const SNIPPET_SELECT = `
  SELECT
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
`;

// D1 allows at most 100 bound parameters per statement
const IN_CHUNK_SIZE = 50;

export class SnippetRepository {
  constructor(private db: D1Database) {}

  /**
   * Fetch fragments for a set of snippets in chunked IN() queries instead of
   * one query per snippet — every D1 statement is a network round trip.
   */
  private async fetchFragmentsFor(snippetIds: number[]): Promise<Map<number, Fragment[]>> {
    const bySnippet = new Map<number, Fragment[]>();
    for (let i = 0; i < snippetIds.length; i += IN_CHUNK_SIZE) {
      const chunk = snippetIds.slice(i, i + IN_CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const { results } = await this.db
        .prepare(
          `SELECT id, snippet_id, file_name, code, language, position
           FROM fragments
           WHERE snippet_id IN (${placeholders})
           ORDER BY position`
        )
        .bind(...chunk)
        .all<Fragment & { snippet_id: number }>();

      for (const row of results) {
        const list = bySnippet.get(row.snippet_id) ?? [];
        list.push({
          id: row.id,
          file_name: row.file_name,
          code: row.code,
          language: row.language,
          position: row.position,
        });
        bySnippet.set(row.snippet_id, list);
      }
    }
    return bySnippet;
  }

  private processRow(row: SnippetRow, fragments: Fragment[]): Snippet {
    const { total_count: _totalCount, ...rest } = row;
    return {
      ...rest,
      categories: row.categories ? row.categories.split(',') : [],
      fragments,
      share_count: row.share_count || 0,
    };
  }

  private async processRows(rows: SnippetRow[]): Promise<Snippet[]> {
    const fragmentsMap = await this.fetchFragmentsFor(rows.map((r) => r.id));
    return rows.map((row) => this.processRow(row, fragmentsMap.get(row.id) ?? []));
  }

  async findById(id: number | string, userId: number | null = null): Promise<Snippet | null> {
    try {
      const stmt =
        userId != null
          ? this.db
              .prepare(
                `${SNIPPET_SELECT}
                 WHERE s.id = ? AND (s.user_id = ? OR s.is_public = 1) AND s.expiry_date IS NULL
                 GROUP BY s.id`
              )
              .bind(id, userId)
          : this.db
              .prepare(
                `${SNIPPET_SELECT}
                 WHERE s.id = ? AND s.is_public = 1 AND s.expiry_date IS NULL
                 GROUP BY s.id`
              )
              .bind(id);

      const row = await stmt.first<SnippetRow>();
      if (!row) return null;
      const [snippet] = await this.processRows([row]);
      return snippet;
    } catch (error) {
      Logger.error('Error in findById:', error);
      throw error;
    }
  }

  async create(
    { title, description, categories = [], fragments = [], isPublic = 0 }: SnippetInput,
    userId: number
  ): Promise<Snippet | null> {
    try {
      const inserted = await this.db
        .prepare(
          `INSERT INTO snippets (title, description, updated_at, expiry_date, user_id, is_public)
           VALUES (?, ?, datetime('now', 'utc'), NULL, ?, ?)
           RETURNING id`
        )
        .bind(title, description ?? '', userId, isPublic ? 1 : 0)
        .first<{ id: number }>();

      if (!inserted) throw new Error('Insert returned no id');
      const snippetId = inserted.id;

      const children = this.childInsertStatements(snippetId, fragments, categories);
      if (children.length > 0) {
        try {
          await this.db.batch(children);
        } catch (error) {
          // The parent insert and the children batch are separate D1 calls, so
          // compensate to avoid leaving an empty snippet behind.
          await this.db.prepare('DELETE FROM snippets WHERE id = ?').bind(snippetId).run();
          throw error;
        }
      }

      return this.findById(snippetId, userId);
    } catch (error) {
      Logger.error('Error in create:', error);
      throw error;
    }
  }

  private childInsertStatements(
    snippetId: number,
    fragments: Fragment[],
    categories: string[]
  ): D1PreparedStatement[] {
    const stmts: D1PreparedStatement[] = [];

    const insertFragment = this.db.prepare(
      `INSERT INTO fragments (snippet_id, file_name, code, language, position)
       VALUES (?, ?, ?, ?, ?)`
    );
    fragments.forEach((fragment, index) => {
      stmts.push(
        insertFragment.bind(
          snippetId,
          fragment.file_name || `file${index + 1}`,
          fragment.code || '',
          fragment.language || 'plaintext',
          fragment.position ?? index
        )
      );
    });

    const insertCategory = this.db.prepare(
      'INSERT INTO categories (snippet_id, name) VALUES (?, ?)'
    );
    for (const category of categories) {
      if (category.trim()) {
        stmts.push(insertCategory.bind(snippetId, category.trim().toLowerCase()));
      }
    }

    return stmts;
  }

  async update(
    id: number | string,
    { title, description, categories = [], fragments = [], isPublic = 0 }: SnippetInput,
    userId: number
  ): Promise<Snippet | null> {
    try {
      const owned = await this.db
        .prepare('SELECT id FROM snippets WHERE id = ? AND user_id = ?')
        .bind(id, userId)
        .first<{ id: number }>();
      if (!owned) return null;

      // Single atomic batch: update + replace fragments/categories
      const stmts: D1PreparedStatement[] = [
        this.db
          .prepare(
            `UPDATE snippets
             SET title = ?, description = ?, updated_at = datetime('now', 'utc'), is_public = ?
             WHERE id = ? AND user_id = ?`
          )
          .bind(title, description ?? '', isPublic ? 1 : 0, id, userId),
        this.db.prepare('DELETE FROM fragments WHERE snippet_id = ?').bind(owned.id),
        this.db.prepare('DELETE FROM categories WHERE snippet_id = ?').bind(owned.id),
        ...this.childInsertStatements(owned.id, fragments, categories),
      ];
      await this.db.batch(stmts);

      return this.findById(id, userId);
    } catch (error) {
      Logger.error('Error in update:', error);
      throw error;
    }
  }

  async delete(id: number | string, userId: number): Promise<{ id: number } | null> {
    try {
      const row = await this.db
        .prepare('DELETE FROM snippets WHERE id = ? AND user_id = ? RETURNING id')
        .bind(id, userId)
        .first<{ id: number }>();
      return row ?? null;
    } catch (error) {
      Logger.error('Error in delete:', error);
      throw error;
    }
  }

  async moveToRecycle(id: number | string, userId: number): Promise<Snippet | null> {
    try {
      const snippet = await this.findById(id, userId);
      if (!snippet || snippet.user_id !== userId) return null;

      await this.db
        .prepare(
          `UPDATE snippets SET expiry_date = datetime('now', '+30 days') WHERE id = ? AND user_id = ?`
        )
        .bind(id, userId)
        .run();
      return snippet;
    } catch (error) {
      Logger.error('Error in moveToRecycle:', error);
      throw error;
    }
  }

  async restore(id: number | string, userId: number): Promise<void> {
    try {
      await this.db
        .prepare('UPDATE snippets SET expiry_date = NULL WHERE id = ? AND user_id = ?')
        .bind(id, userId)
        .run();
    } catch (error) {
      Logger.error('Error in restore:', error);
      throw error;
    }
  }

  /** Permanently delete recycle-bin snippets whose expiry has passed. Returns deleted count. */
  async deleteExpired(): Promise<number> {
    try {
      const currentTime = new Date().toISOString();
      const result = await this.db
        .prepare(
          `DELETE FROM snippets
           WHERE expiry_date IS NOT NULL AND datetime(expiry_date) <= datetime(?, 'utc')`
        )
        .bind(currentTime)
        .run();
      return result.meta.changes ?? 0;
    } catch (error) {
      Logger.error('Error in deleteExpired:', error);
      throw error;
    }
  }

  async setPinned(id: number | string, value: boolean, userId: number): Promise<Snippet | null> {
    try {
      const result = await this.db
        .prepare('UPDATE snippets SET is_pinned = ? WHERE id = ? AND user_id = ?')
        .bind(value ? 1 : 0, id, userId)
        .run();
      if ((result.meta.changes ?? 0) === 0) return null;
      return this.findById(id, userId);
    } catch (error) {
      Logger.error('Error in setPinned:', error);
      throw error;
    }
  }

  async setFavorite(id: number | string, value: boolean, userId: number): Promise<Snippet | null> {
    try {
      const result = await this.db
        .prepare('UPDATE snippets SET is_favorite = ? WHERE id = ? AND user_id = ?')
        .bind(value ? 1 : 0, id, userId)
        .run();
      if ((result.meta.changes ?? 0) === 0) return null;
      return this.findById(id, userId);
    } catch (error) {
      Logger.error('Error in setFavorite:', error);
      throw error;
    }
  }

  async findAllPaginated({
    userId = null,
    filters = {},
    sort = 'newest',
    limit = 50,
    offset = 0,
  }: {
    userId?: number | null;
    filters?: SnippetFilters;
    sort?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ snippets: Snippet[]; total: number }> {
    try {
      let sql = `
        SELECT
          s.id,
          s.title,
          s.description,
          datetime(s.updated_at) || 'Z' as updated_at,
          CASE WHEN s.expiry_date IS NOT NULL THEN datetime(s.expiry_date) || 'Z' ELSE NULL END as expiry_date,
          s.user_id,
          s.is_public,
          s.is_pinned,
          s.is_favorite,
          u.username,
          GROUP_CONCAT(DISTINCT c.name) as categories,
          (SELECT COUNT(*) FROM shared_snippets WHERE snippet_id = s.id) as share_count,
          COUNT(*) OVER() as total_count
        FROM snippets s
        LEFT JOIN categories c ON s.id = c.snippet_id
        LEFT JOIN users u ON s.user_id = u.id
        WHERE 1=1
      `;

      const params: unknown[] = [];

      if (userId !== null) {
        sql += ' AND s.user_id = ?';
        params.push(userId);
      } else {
        sql += ' AND s.is_public = 1';
      }

      if (filters.recycled) {
        sql += ' AND s.expiry_date IS NOT NULL';
      } else {
        sql += ' AND s.expiry_date IS NULL';
      }

      if (filters.favorites) {
        sql += ' AND s.is_favorite = 1';
      }

      if (filters.pinned) {
        sql += ' AND s.is_pinned = 1';
      }

      if (filters.search) {
        sql += ' AND (s.title LIKE ? OR s.description LIKE ?';
        params.push(`%${filters.search}%`, `%${filters.search}%`);

        if (filters.searchCode) {
          sql += ` OR EXISTS (
            SELECT 1 FROM fragments f
            WHERE f.snippet_id = s.id AND f.code LIKE ?
          )`;
          params.push(`%${filters.search}%`);
        }
        sql += ')';
      }

      if (filters.language) {
        sql += ` AND EXISTS (
          SELECT 1 FROM fragments f
          WHERE f.snippet_id = s.id AND f.language = ?
        )`;
        params.push(filters.language);
      }

      sql += ' GROUP BY s.id';

      // Category AND logic: must have ALL selected categories
      if (filters.categories && filters.categories.length > 0) {
        sql += ` HAVING COUNT(DISTINCT CASE WHEN c.name IN (${filters.categories
          .map(() => '?')
          .join(',')}) THEN c.name END) = ?`;
        params.push(...filters.categories, filters.categories.length);
      }

      // Pinned snippets always come first
      sql += ' ORDER BY s.is_pinned DESC, ';
      switch (sort) {
        case 'oldest':
          sql += 's.updated_at ASC';
          break;
        case 'alpha-asc':
          sql += 's.title ASC';
          break;
        case 'alpha-desc':
          sql += 's.title DESC';
          break;
        case 'newest':
        default:
          sql += 's.updated_at DESC';
      }

      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const { results } = await this.db
        .prepare(sql)
        .bind(...params)
        .all<SnippetRow>();

      const total = results.length > 0 ? (results[0].total_count ?? 0) : 0;
      const snippets = await this.processRows(results);

      return { snippets, total };
    } catch (error) {
      Logger.error('Error in findAllPaginated:', error);
      throw error;
    }
  }

  async getMetadata(userId: number | null = null): Promise<{
    categories: string[];
    languages: string[];
    counts: { total: number };
  }> {
    try {
      const scope = userId !== null ? 's.user_id = ?' : 's.is_public = 1';
      const scopeParams = userId !== null ? [userId] : [];

      const [categoriesRes, languagesRes, countRes] = await this.db.batch([
        this.db
          .prepare(
            `SELECT DISTINCT c.name
             FROM categories c
             INNER JOIN snippets s ON c.snippet_id = s.id
             WHERE s.expiry_date IS NULL AND ${scope}
             ORDER BY c.name`
          )
          .bind(...scopeParams),
        this.db
          .prepare(
            `SELECT DISTINCT f.language
             FROM fragments f
             INNER JOIN snippets s ON f.snippet_id = s.id
             WHERE s.expiry_date IS NULL AND ${scope}
             ORDER BY f.language`
          )
          .bind(...scopeParams),
        this.db
          .prepare(
            `SELECT COUNT(*) as count FROM snippets s WHERE s.expiry_date IS NULL AND ${scope}`
          )
          .bind(...scopeParams),
      ]);

      return {
        categories: (categoriesRes.results as { name: string }[]).map((r) => r.name),
        languages: (languagesRes.results as { language: string }[]).map((r) => r.language),
        counts: { total: (countRes.results as { count: number }[])[0]?.count ?? 0 },
      };
    } catch (error) {
      Logger.error('Error in getMetadata:', error);
      throw error;
    }
  }
}
