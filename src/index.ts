#!/usr/bin/env node

/**
 * Canvas MCP Server - Read-only access to Canvas LMS
 * Streamable HTTP Transport (Server-Sent Events)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';
import express from 'express';
import { timingSafeEqual } from 'crypto';
import { CanvasClient } from './canvas-client.js';
import { TOOLS, handleToolCall } from './tools.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL;
const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;
const PORT = parseInt(process.env.PORT || '8080', 10);
const BASE_PATH = process.env.BASE_PATH || '/mcp';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:*', 'http://127.0.0.1:*'];
const CANVAS_TIMEOUT_MS = Number.isFinite(Number(process.env.CANVAS_TIMEOUT_MS))
  ? Math.max(1, Math.floor(Number(process.env.CANVAS_TIMEOUT_MS)))
  : 15000;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';

if (!CANVAS_BASE_URL || !CANVAS_API_TOKEN) {
  console.error('Error: Missing required environment variables');
  console.error('Please set CANVAS_BASE_URL and CANVAS_API_TOKEN in your .env file');
  console.error('See .env.example for template');
  process.exit(1);
}

// Initialize Canvas client
const canvasClient = new CanvasClient({
  baseUrl: CANVAS_BASE_URL,
  apiToken: CANVAS_API_TOKEN,
  timeoutMs: CANVAS_TIMEOUT_MS,
});

// Create Express app
const app = express();
app.use(express.json());

/**
 * Origin validation middleware - protects against CORS issues and DNS rebinding
 */
function validateOrigin(origin: string | undefined): boolean {
  if (!origin) {
    // Allow requests without Origin header (non-browser clients)
    return true;
  }

  try {
    const originUrl = new URL(origin);

    // Check against allowed origins (with wildcard port support)
    for (const allowed of ALLOWED_ORIGINS) {
      if (allowed.includes('*')) {
        // Wildcard port matching
        const [allowedHost, _] = allowed.split(':');
        const originHost = `${originUrl.protocol}//${originUrl.hostname}`;
        if (originHost === allowedHost.replace('*', '')) {
          return true;
        }
      } else if (origin === allowed) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * DNS rebinding protection - validates Host header
 */
function validateHost(host: string | undefined): boolean {
  if (!host) {
    return false;
  }

  // Allow localhost and 127.0.0.1 in any port
  if (host.startsWith('localhost:') || host === 'localhost' ||
      host.startsWith('127.0.0.1:') || host === '127.0.0.1' ||
      host.startsWith('0.0.0.0:') || host === '0.0.0.0') {
    return true;
  }

  // Allow private IP ranges (for LAN deployment like Raspberry Pi)
  const ipMatch = host.match(/^(\d+\.\d+\.\d+\.\d+)/);
  if (ipMatch) {
    const ip = ipMatch[1];
    // 192.168.x.x, 10.x.x.x, 172.16-31.x.x
    if (ip.startsWith('192.168.') || ip.startsWith('10.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
      return true;
    }
  }

  // Allow .local domains (mDNS like raspberrypi.local)
  if (host.endsWith('.local') || host.endsWith('.local:' + PORT)) {
    return true;
  }

  return false;
}

/**
 * Security middleware for MCP endpoint
 */
function securityMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.headers.origin;
  const host = req.headers.host;

  // Validate Host header (DNS rebinding protection)
  if (!validateHost(host)) {
    console.warn(`Rejected request with invalid Host: ${host}`);
    return res.status(403).json({ error: 'Forbidden: Invalid Host header' });
  }

  // Validate Origin header (if present)
  if (origin && !validateOrigin(origin)) {
    console.warn(`Rejected request with invalid Origin: ${origin}`);
    return res.status(403).json({ error: 'Forbidden: Invalid Origin' });
  }

  next();
}

/**
 * Optional Bearer auth for MCP endpoint (applied after security checks)
 */
function mcpAuthMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!MCP_AUTH_TOKEN) {
    return next(); // no-auth mode
  }

  const raw = req.headers['authorization'];
  if (!raw || typeof raw !== 'string') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const auth = raw.trim();
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const providedToken = match[1].trim();
  const provided = Buffer.from(providedToken, 'utf8');
  const expected = Buffer.from(MCP_AUTH_TOKEN, 'utf8');

  if (provided.length !== expected.length) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!timingSafeEqual(provided, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  return next();
}

// Health check endpoint
app.get('/healthz', (_req, res) => {
  res.status(200).send('OK');
});

// Apply security + optional auth to all MCP requests (both GET/POST)
app.use(BASE_PATH, securityMiddleware, mcpAuthMiddleware);

// Helper to create a new MCP server with handlers
function createMcpServer() {
  const server = new Server(
    {
      name: 'canvas-mcp',
      version: '0.5.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const started = Date.now();
    try {
      const result = { tools: TOOLS };
      const duration = Date.now() - started;
      console.log(JSON.stringify({ level: 'info', event: 'list_tools', requestId: (request as any)?.id ?? null, duration_ms: duration, success: true }));
      return result;
    } catch (err) {
      const duration = Date.now() - started;
      console.log(JSON.stringify({ level: 'error', event: 'list_tools', requestId: (request as any)?.id ?? null, duration_ms: duration, success: false }));
      throw err;
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const started = Date.now();
    try {
      const result = await handleToolCall(name, args || {}, canvasClient);
      const duration = Date.now() - started;
      console.log(JSON.stringify({ level: 'info', event: 'tool_call', tool: name, requestId: (request as any)?.id ?? null, duration_ms: duration, success: true }));
      return result;
    } catch (error: any) {
      const duration = Date.now() - started;
      const code = error?.code || (error?.name === 'AbortError' ? 'timeout' : 'internal_error');
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.log(JSON.stringify({ level: 'error', event: 'tool_call', tool: name, requestId: (request as any)?.id ?? null, duration_ms: duration, success: false, code }));
      return { content: [{ type: 'text', text: `Error [${code}]: ${msg}` }], isError: true } as any;
    }
  });

  return server;
}

// MCP Streamable HTTP endpoint - POST negotiates session; POST with sessionId processes JSON-RPC; GET maintains SSE stream
app.post(BASE_PATH, async (req, res) => {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;

  if (sessionId) {
    // Direct JSON-RPC processing for existing session
    const body = req.body;
    const badRequest = (message: string) => res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message }, id: null });

    if (!body || typeof body !== 'object') {
      return badRequest('Invalid request body');
    }

    // Support only single request for minimal surface; batch can be added later
    const { jsonrpc, method, id, params } = body as any;
    if (jsonrpc !== '2.0' || typeof method !== 'string') {
      return badRequest('Invalid JSON-RPC 2.0 request');
    }

    if (method === 'tools/list') {
      const started = Date.now();
      try {
        const result = { tools: TOOLS };
        const duration = Date.now() - started;
        console.log(JSON.stringify({ level: 'info', event: 'list_tools', requestId: id ?? null, duration_ms: duration, success: true }));
        return res.json({ jsonrpc: '2.0', id, result });
      } catch (e) {
        const duration = Date.now() - started;
        console.log(JSON.stringify({ level: 'error', event: 'list_tools', requestId: id ?? null, duration_ms: duration, success: false }));
        return res.json({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } });
      }
    }

    if (method === 'tools/call') {
      const started = Date.now();
      try {
        const name = params?.name;
        const args = params?.arguments || {};
        const result = await handleToolCall(name, args, canvasClient);
        const duration = Date.now() - started;
        console.log(JSON.stringify({ level: 'info', event: 'tool_call', tool: name, requestId: id ?? null, duration_ms: duration, success: true }));
        return res.json({ jsonrpc: '2.0', id, result });
      } catch (error: any) {
        const duration = Date.now() - started;
        const code = error?.code || (error?.name === 'AbortError' ? 'timeout' : 'internal_error');
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.log(JSON.stringify({ level: 'error', event: 'tool_call', tool: params?.name, requestId: id ?? null, duration_ms: duration, success: false, code }));
        // Return as a successful result with isError (mirrors transport behavior), not protocol error
        return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error [${code}]: ${msg}` }], isError: true } });
      }
    }

    // Method not found
    return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }

  // No sessionId: negotiate a new session via SSE transport
  console.log('New MCP connection from:', req.headers.host);
  const server = createMcpServer();
  const transport = new SSEServerTransport(BASE_PATH, res);
  await server.connect(transport);
});

// Start HTTP server
async function main() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Canvas MCP server running on http://0.0.0.0:${PORT}`);
    console.log(`MCP endpoint: http://0.0.0.0:${PORT}${BASE_PATH}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/healthz`);
    console.log(`Transport: Streamable HTTP (Server-Sent Events)`);
    console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`Security: Origin validation + DNS rebinding protection enabled`);
    console.log(`Canvas timeout: ${CANVAS_TIMEOUT_MS}ms`);
    if (MCP_AUTH_TOKEN) {
      console.log('MCP auth: Bearer token required');
    } else {
      console.log('MCP auth: disabled (no-auth mode)');
    }
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
