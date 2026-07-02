import { Hono } from 'hono';
import { configureLogger } from './logger.js';
import {
  authenticateApiKey,
  authenticateMcp,
  authenticateUser,
  requireAdmin,
} from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import snippetRoutes from './routes/snippets.js';
import attachmentRoutes from './routes/attachments.js';
import shareRoutes from './routes/share.js';
import publicRoutes from './routes/public.js';
import embedRoutes from './routes/embed.js';
import apiKeyRoutes from './routes/apiKeys.js';
import adminRoutes from './routes/admin.js';
import mcpRoutes from './routes/mcp.js';
import { runScheduled } from './scheduled.js';
import type { AppEnv, Env } from './types.js';

const MAX_JSON_BODY = 2 * 1024 * 1024; // same 2 MB cap as the Express app

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  configureLogger(c.env.DEBUG === 'true');

  // Attachment uploads stream to R2 and have their own (higher) limit
  const isAttachmentUpload = /\/attachments/.test(c.req.path);
  if (!isAttachmentUpload) {
    const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
    if (contentLength > MAX_JSON_BODY) {
      return c.json({ error: 'Request body too large' }, 413);
    }
  }

  return next();
});

app.route('/api/auth', authRoutes);

app.use('/api/keys/*', authenticateUser);
app.route('/api/keys', apiKeyRoutes);

// Snippets accept either an API key (x-api-key) or an Access identity
const snippets = new Hono<AppEnv>();
snippets.use('*', authenticateApiKey, authenticateUser);
snippets.route('/:id/attachments', attachmentRoutes);
snippets.route('/', snippetRoutes);
app.route('/api/snippets', snippets);

app.route('/api/share', shareRoutes);
app.route('/api/public/snippets', publicRoutes);
app.route('/api/embed', embedRoutes);

app.use('/api/admin/*', authenticateUser, requireAdmin);
app.route('/api/admin', adminRoutes);

// Remote MCP endpoint for AI clients (Claude, OpenAI, Perplexity), authenticated
// with a ByteStash API key (Authorization: Bearer <key> or x-api-key).
app.use('/mcp', authenticateMcp);
app.route('/mcp', mcpRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith('/api') || c.req.path === '/mcp') {
    return c.json({ error: 'Not found' }, 404);
  }
  // Non-API paths are served by the static assets binding (run_worker_first
  // only routes /api/* and /mcp here); reaching this is unexpected.
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    configureLogger(env.DEBUG === 'true');
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
