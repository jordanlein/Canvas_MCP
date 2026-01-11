#!/usr/bin/env node

/**
 * Canvas MCP Server - Read-only access to Canvas LMS
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';
import { CanvasClient } from './canvas-client.js';
import { TOOLS, handleToolCall } from './tools.js';

// Load environment variables
dotenv.config();

// Validate required environment variables
const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL;
const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;

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
});

// Create MCP server
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

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    return await handleToolCall(name, args || {}, canvasClient);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{
        type: 'text',
        text: `Error: ${errorMessage}`,
      }],
      isError: true,
    };
  }
});

// Start server with stdio transport (localhost-only by design)
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Canvas MCP server running on stdio (localhost-only)');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
