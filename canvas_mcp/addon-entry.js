// Home Assistant add-on entrypoint for Canvas MCP
// Reads /data/options.json and maps selected options to environment variables
// Then starts the MCP server

import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';

function loadOptions() {
  try {
    const content = fs.readFileSync('/data/options.json', 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function setEnvFromOptions(opts = {}) {
  if (typeof opts.canvas_base_url === 'string' && opts.canvas_base_url) {
    process.env.CANVAS_BASE_URL = opts.canvas_base_url;
  }
  if (typeof opts.canvas_api_token === 'string' && opts.canvas_api_token) {
    process.env.CANVAS_API_TOKEN = opts.canvas_api_token;
  }
  if (typeof opts.mcp_auth_token === 'string' && opts.mcp_auth_token) {
    process.env.MCP_AUTH_TOKEN = opts.mcp_auth_token;
  }
}

function startServer() {
  const serverPath = path.resolve('/app/dist/index.js');
  const proc = spawn('node', [serverPath], { stdio: 'inherit' });
  proc.on('exit', (code) => process.exit(code ?? 1));
}

const opts = loadOptions();
setEnvFromOptions(opts);
startServer();

