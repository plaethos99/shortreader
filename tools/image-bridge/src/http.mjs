/**
 * The HTTP side, which ShortReader calls:
 *
 *   GET  /status                       → { flow, imagine } each closed | signin | ready
 *   POST /open      { provider }       → opens that site's browser window
 *   POST /generate  { provider, prompt, aspect } → { mimeType, data } (base64)
 *
 * It listens on 127.0.0.1 only, unless SHORTREADER_BRIDGE_HOST says otherwise
 * (to reach it from a phone on the same network). Browsers may call it only
 * from the app's own origins, so a web page you visit can't make pictures on
 * your accounts; set SHORTREADER_BRIDGE_TOKEN to require a token as well.
 */
import http from 'node:http';

import { generate, provider, status } from './providers.mjs';

const ORIGINS = [
  /^tauri:\/\/localhost$/,
  /^https?:\/\/tauri\.localhost$/,
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];
const extraOrigins = (process.env.SHORTREADER_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const TOKEN = process.env.SHORTREADER_BRIDGE_TOKEN ?? '';

const allowedOrigin = (origin) =>
  !origin || extraOrigins.includes(origin) || ORIGINS.some((re) => re.test(origin));

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Body must be JSON'));
      }
    });
    req.on('error', reject);
  });

export const startHttp = ({ port, host, log }) =>
  new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const origin = req.headers.origin;
      const reply = (code, body) => {
        res.writeHead(code, {
          'Content-Type': 'application/json',
          ...(origin && allowedOrigin(origin)
            ? {
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                // Chrome's Private Network Access preflight.
                'Access-Control-Allow-Private-Network': 'true',
                Vary: 'Origin',
              }
            : {}),
        });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };

      if (!allowedOrigin(origin)) return reply(403, { error: `Origin ${origin} is not allowed` });
      if (req.method === 'OPTIONS') return reply(204);
      if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
        return reply(401, { error: 'Wrong or missing bridge token' });
      }

      const url = new URL(req.url ?? '/', 'http://bridge');
      try {
        if (req.method === 'GET' && url.pathname === '/status') {
          return reply(200, { ok: true, ...(await status()) });
        }
        if (req.method === 'POST' && url.pathname === '/open') {
          const { provider: name } = await readJson(req);
          await provider(name).open();
          return reply(200, { ok: true });
        }
        if (req.method === 'POST' && url.pathname === '/generate') {
          const body = await readJson(req);
          log(`${body.provider}: ${String(body.prompt ?? '').slice(0, 80)}…`);
          const image = await generate(body, (status) => log(status));
          return reply(200, { mimeType: image.mimeType, data: image.data.toString('base64') });
        }
        return reply(404, { error: 'Not found' });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log(`error: ${message}`);
        return reply(500, { error: message });
      }
    });
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
