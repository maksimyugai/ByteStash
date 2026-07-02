import Logger from './logger.js';
import { SnippetRepository } from './repositories/snippetRepository.js';
import { ShareRepository } from './repositories/shareRepository.js';
import { AttachmentRepository } from './repositories/attachmentRepository.js';
import type { Env } from './types.js';

const BACKUP_TABLES = [
  'users',
  'snippets',
  'categories',
  'fragments',
  'shared_snippets',
  'api_keys',
  'attachments',
] as const;

const BACKUP_PAGE_SIZE = 500;

/**
 * Nightly maintenance:
 *  1. purge recycle-bin snippets whose 30-day expiry passed (plus their R2 attachments)
 *  2. purge expired share links
 *  3. export every table to R2 as NDJSON — a portable safety net on top of D1 Time Travel
 */
export async function runScheduled(env: Env): Promise<void> {
  const snippets = new SnippetRepository(env.DB);
  const shares = new ShareRepository(env.DB);
  const attachments = new AttachmentRepository(env.DB);

  try {
    // Collect attachment keys before the rows disappear via FK cascade
    const expiredKeys = await attachments.keysForExpiredSnippets(new Date().toISOString());
    const deletedSnippets = await snippets.deleteExpired();
    if (expiredKeys.length > 0) {
      await env.BUCKET.delete(expiredKeys);
    }

    const deletedShares = await shares.deleteExpiredShares();
    Logger.info(
      `Cron cleanup: ${deletedSnippets} expired snippets, ${deletedShares} expired shares, ${expiredKeys.length} orphaned attachments`
    );
  } catch (error) {
    Logger.error('Cron cleanup failed:', error);
  }

  try {
    await backupToR2(env);
  } catch (error) {
    Logger.error('Cron backup failed:', error);
  }
}

async function backupToR2(env: Env): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);

  for (const table of BACKUP_TABLES) {
    const lines: string[] = [];
    let cursor = -1;

    // Keyset pagination over rowid so large tables don't blow the response limit
    for (;;) {
      const { results } = await env.DB.prepare(
        `SELECT rowid as _rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`
      )
        .bind(cursor, BACKUP_PAGE_SIZE)
        .all<Record<string, unknown>>();

      if (results.length === 0) break;

      for (const row of results) {
        const { _rowid, ...data } = row;
        cursor = _rowid as number;
        lines.push(JSON.stringify(data));
      }

      if (results.length < BACKUP_PAGE_SIZE) break;
    }

    await env.BUCKET.put(`backups/${date}/${table}.ndjson`, lines.join('\n'), {
      httpMetadata: { contentType: 'application/x-ndjson' },
    });
  }

  Logger.info(`Backup written to backups/${date}/`);
}
