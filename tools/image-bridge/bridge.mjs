#!/usr/bin/env node
/**
 * ShortReader image bridge: makes pictures in Google Flow or Grok Imagine by
 * driving a real browser window where you are signed in.
 *
 *   node bridge.mjs          HTTP server for the ShortReader app (port 7531)
 *   node bridge.mjs --mcp    MCP server on stdio, plus the HTTP server when
 *                            its port is free
 */
import { readFileSync } from 'node:fs';

import { startHttp } from './src/http.mjs';
import { startMcp } from './src/mcp.mjs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const mcp = process.argv.includes('--mcp');
const port = Number(process.env.SHORTREADER_BRIDGE_PORT ?? 7531);
const host = process.env.SHORTREADER_BRIDGE_HOST ?? '127.0.0.1';
// In MCP mode stdout is the protocol, so everything else goes to stderr.
const log = (line) => (mcp ? console.error : console.log)(`[image-bridge] ${line}`);

if (typeof WebSocket === 'undefined') {
  console.error('The image bridge needs Node.js 22 or newer.');
  process.exit(1);
}

if (mcp) startMcp({ version });

try {
  await startHttp({ port, host, log });
  log(`listening on http://${host}:${port} — point ShortReader's image settings here`);
} catch (e) {
  if (!mcp) {
    console.error(`[image-bridge] could not listen on ${host}:${port}: ${e.message}`);
    process.exit(1);
  }
  // Another bridge already serves the app; this one only answers MCP.
  log(`HTTP port ${port} is taken (${e.code ?? e.message}); serving MCP only`);
}
