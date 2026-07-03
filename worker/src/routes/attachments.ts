import { Hono } from 'hono';
import Logger from '../logger.js';
import { AttachmentRepository } from '../repositories/attachmentRepository.js';
import type { AppEnv } from '../types.js';

// Attachment payloads stream straight to/from R2. Keep a sane per-file cap
// well under the Workers request-body limit (100 MB on the paid plan).
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

/**
 * Mounted under /api/snippets/:id/attachments — the auth middleware of the
 * snippets router has already run, and every query double-checks that the
 * snippet belongs to the current user.
 */
const attachments = new Hono<AppEnv>();

async function ownedSnippetId(c: {
  env: { DB: D1Database };
}, id: string, userId: number): Promise<number | null> {
  const row = await c.env.DB.prepare(
    'SELECT id FROM snippets WHERE id = ? AND user_id = ? AND expiry_date IS NULL'
  )
    .bind(id, userId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

attachments.get('/', async (c) => {
  try {
    const snippetId = await ownedSnippetId(c, c.req.param('id') ?? '', c.get('user').id);
    if (!snippetId) {
      return c.json({ error: 'Snippet not found' }, 404);
    }

    const repo = new AttachmentRepository(c.env.DB);
    const list = await repo.listBySnippet(snippetId);
    return c.json(
      list.map(({ r2_key: _r2Key, ...rest }) => rest)
    );
  } catch (error) {
    Logger.error('Error listing attachments:', error);
    return c.json({ error: 'Failed to list attachments' }, 500);
  }
});

attachments.post('/', async (c) => {
  try {
    const user = c.get('user');
    const snippetId = await ownedSnippetId(c, c.req.param('id') ?? '', user.id);
    if (!snippetId) {
      return c.json({ error: 'Snippet not found' }, 404);
    }

    const fileName = decodeURIComponent(c.req.header('x-file-name') ?? '').trim();
    if (!fileName) {
      return c.json({ error: 'x-file-name header is required' }, 400);
    }

    if (!c.req.raw.body) {
      return c.json({ error: 'Request body is required' }, 400);
    }
    const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
    if (contentLength > MAX_ATTACHMENT_SIZE) {
      return c.json({ error: 'Attachment too large (max 25 MB)' }, 413);
    }

    const mime = c.req.header('content-type') || 'application/octet-stream';
    const r2Key = `attachments/${user.id}/${snippetId}/${crypto.randomUUID()}`;

    // Stream the body straight into R2 — no buffering in the worker
    const object = await c.env.BUCKET.put(r2Key, c.req.raw.body, {
      httpMetadata: {
        contentType: mime,
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });

    // Content-Length can be absent on streamed uploads — enforce the cap on
    // the actual stored size too.
    if (object.size > MAX_ATTACHMENT_SIZE) {
      c.executionCtx.waitUntil(c.env.BUCKET.delete(r2Key));
      return c.json({ error: 'Attachment too large (max 25 MB)' }, 413);
    }

    const repo = new AttachmentRepository(c.env.DB);
    try {
      const created = await repo.create({
        snippetId,
        fileName,
        mime,
        size: object.size,
        r2Key,
      });
      if (!created) throw new Error('Insert failed');
      const { r2_key: _r2Key, ...rest } = created;
      return c.json(rest, 201);
    } catch (error) {
      // Metadata insert failed — don't leave an orphan object in the bucket
      c.executionCtx.waitUntil(c.env.BUCKET.delete(r2Key));
      throw error;
    }
  } catch (error) {
    Logger.error('Error uploading attachment:', error);
    return c.json({ error: 'Failed to upload attachment' }, 500);
  }
});

attachments.get('/:attachmentId', async (c) => {
  try {
    const snippetId = await ownedSnippetId(c, c.req.param('id') ?? '', c.get('user').id);
    if (!snippetId) {
      return c.json({ error: 'Snippet not found' }, 404);
    }

    const repo = new AttachmentRepository(c.env.DB);
    const attachment = await repo.findById(c.req.param('attachmentId'));
    if (!attachment || attachment.snippet_id !== snippetId) {
      return c.json({ error: 'Attachment not found' }, 404);
    }

    const object = await c.env.BUCKET.get(attachment.r2_key);
    if (!object) {
      return c.json({ error: 'Attachment content missing' }, 404);
    }

    return new Response(object.body as ReadableStream, {
      headers: {
        'Content-Type': attachment.mime,
        'Content-Length': String(attachment.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
          attachment.file_name
        )}`,
        'Cache-Control': 'private, max-age=0',
      },
    });
  } catch (error) {
    Logger.error('Error downloading attachment:', error);
    return c.json({ error: 'Failed to download attachment' }, 500);
  }
});

attachments.delete('/:attachmentId', async (c) => {
  try {
    const snippetId = await ownedSnippetId(c, c.req.param('id') ?? '', c.get('user').id);
    if (!snippetId) {
      return c.json({ error: 'Snippet not found' }, 404);
    }

    const repo = new AttachmentRepository(c.env.DB);
    const attachment = await repo.findById(c.req.param('attachmentId'));
    if (!attachment || attachment.snippet_id !== snippetId) {
      return c.json({ error: 'Attachment not found' }, 404);
    }

    await repo.delete(attachment.id);
    c.executionCtx.waitUntil(c.env.BUCKET.delete(attachment.r2_key));

    return c.json({ success: true });
  } catch (error) {
    Logger.error('Error deleting attachment:', error);
    return c.json({ error: 'Failed to delete attachment' }, 500);
  }
});

export default attachments;
