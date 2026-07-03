import Logger from '../logger.js';

export interface AttachmentRow {
  id: number;
  snippet_id: number;
  file_name: string;
  mime: string;
  size: number;
  r2_key: string;
  created_at: string;
}

export class AttachmentRepository {
  constructor(private db: D1Database) {}

  async listBySnippet(snippetId: number | string): Promise<AttachmentRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, snippet_id, file_name, mime, size, r2_key, created_at
         FROM attachments WHERE snippet_id = ? ORDER BY created_at DESC`
      )
      .bind(snippetId)
      .all<AttachmentRow>();
    return results;
  }

  async findById(id: number | string): Promise<AttachmentRow | null> {
    return this.db
      .prepare(
        `SELECT id, snippet_id, file_name, mime, size, r2_key, created_at
         FROM attachments WHERE id = ?`
      )
      .bind(id)
      .first<AttachmentRow>();
  }

  async create(input: {
    snippetId: number;
    fileName: string;
    mime: string;
    size: number;
    r2Key: string;
  }): Promise<AttachmentRow | null> {
    try {
      return await this.db
        .prepare(
          `INSERT INTO attachments (snippet_id, file_name, mime, size, r2_key)
           VALUES (?, ?, ?, ?, ?)
           RETURNING id, snippet_id, file_name, mime, size, r2_key, created_at`
        )
        .bind(input.snippetId, input.fileName, input.mime, input.size, input.r2Key)
        .first<AttachmentRow>();
    } catch (error) {
      Logger.error('Error creating attachment:', error);
      throw error;
    }
  }

  async delete(id: number | string): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
    return (result.meta.changes ?? 0) > 0;
  }

  /** R2 keys for a snippet — collected before deleting the snippet so the objects can be removed too. */
  async keysForSnippet(snippetId: number | string): Promise<string[]> {
    const { results } = await this.db
      .prepare('SELECT r2_key FROM attachments WHERE snippet_id = ?')
      .bind(snippetId)
      .all<{ r2_key: string }>();
    return results.map((r) => r.r2_key);
  }

  /** R2 keys for every attachment owned by expired recycle-bin snippets (cron cleanup). */
  async keysForExpiredSnippets(now: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT a.r2_key FROM attachments a
         JOIN snippets s ON s.id = a.snippet_id
         WHERE s.expiry_date IS NOT NULL AND datetime(s.expiry_date) <= datetime(?, 'utc')`
      )
      .bind(now)
      .all<{ r2_key: string }>();
    return results.map((r) => r.r2_key);
  }
}
