import { Hono } from 'hono';
import { StreamableHTTPTransport } from '@hono/mcp';
import Logger from '../logger.js';
import { createMcpServer } from '../mcp/snippetMcpServer.js';
import type { AppEnv } from '../types.js';

/*
 * Remote MCP endpoint, stateless mode: a fresh server + transport per request,
 * same behaviour as the Node version. `authenticateMcp` (mounted before this
 * router) has already resolved the API key to a user.
 */
const mcp = new Hono<AppEnv>();

mcp.all('/', async (c) => {
  try {
    const server = createMcpServer(c.env.DB, c.get('user').id);
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return await transport.handleRequest(c);
  } catch (error) {
    Logger.error('Error handling MCP request:', error);
    return c.json(
      { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null },
      500
    );
  }
});

export default mcp;
