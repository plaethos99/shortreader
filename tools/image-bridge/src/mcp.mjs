/**
 * The MCP side: a stdio server (newline-delimited JSON-RPC 2.0), so an agent
 * such as Claude Code or Claude Desktop can make pictures in Flow or Grok
 * Imagine with the same drivers the app uses. No SDK: the four methods an
 * MCP client needs are small enough to answer here.
 */
import { writeFileSync } from 'node:fs';
import readline from 'node:readline';

import { ASPECTS, PROVIDERS, generate, provider, status } from './providers.mjs';

const PROTOCOL_VERSION = '2025-06-18';

const TOOLS = [
  {
    name: 'generate_image',
    description:
      'Make one picture in Google Flow or Grok Imagine, in a real browser window where the user is signed in. Returns the image (and saves it when out_path is given).',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: PROVIDERS, description: 'flow = Google Flow, imagine = Grok Imagine' },
        prompt: { type: 'string', description: 'What to draw' },
        aspect: { type: 'string', enum: ASPECTS, default: '16:9' },
        out_path: { type: 'string', description: 'Optional file to save the picture to' },
      },
      required: ['provider', 'prompt'],
    },
  },
  {
    name: 'open_provider',
    description: 'Open Google Flow or Grok Imagine in its browser window, to sign in or look.',
    inputSchema: {
      type: 'object',
      properties: { provider: { type: 'string', enum: PROVIDERS } },
      required: ['provider'],
    },
  },
  {
    name: 'provider_status',
    description: 'Whether each provider window is closed, waiting for sign-in, or ready.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const callTool = async (name, args = {}) => {
  if (name === 'generate_image') {
    const image = await generate(args);
    if (args.out_path) writeFileSync(args.out_path, image.data);
    return {
      content: [
        { type: 'image', data: image.data.toString('base64'), mimeType: image.mimeType },
        ...(args.out_path ? [{ type: 'text', text: `Saved to ${args.out_path}` }] : []),
      ],
    };
  }
  if (name === 'open_provider') {
    await provider(args.provider).open();
    return { content: [{ type: 'text', text: `Opened ${args.provider}.` }] };
  }
  if (name === 'provider_status') {
    return { content: [{ type: 'text', text: JSON.stringify(await status()) }] };
  }
  throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 });
};

export const startMcp = ({ version }) => {
  const write = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  const rl = readline.createInterface({ input: process.stdin });

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return write({ id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const { id, method, params } = msg;
    // Notifications (no id) need no answer.
    if (id === undefined) return;
    try {
      if (method === 'initialize') {
        return write({
          id,
          result: {
            protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'shortreader-image-bridge', version },
          },
        });
      }
      if (method === 'ping') return write({ id, result: {} });
      if (method === 'tools/list') return write({ id, result: { tools: TOOLS } });
      if (method === 'tools/call') {
        try {
          return write({ id, result: await callTool(params?.name, params?.arguments) });
        } catch (e) {
          if (e?.code) throw e;
          // A failed generation is a tool result the agent can read, not a protocol error.
          const text = e instanceof Error ? e.message : String(e);
          return write({ id, result: { content: [{ type: 'text', text }], isError: true } });
        }
      }
      write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (e) {
      write({ id, error: { code: e?.code ?? -32603, message: e?.message ?? String(e) } });
    }
  });
  rl.on('close', () => process.exit(0));
};
