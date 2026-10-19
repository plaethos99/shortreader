/**
 * The image engine's Platform on Node: the web app's own server route
 * (app/api/imagegen) and the image bridge (tools/image-bridge). Launches
 * Microsoft Edge or Google Chrome with a profile of its own — the reader's
 * everyday profile, passwords and cookies are never touched — and the DevTools
 * protocol on a local port, which only this machine can reach.
 *
 * Imports only Node built-ins (and types), so the bridge can run it directly.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Connection, ImageProvider, Platform, Tab } from './core';

const home = os.homedir();
const localAppData = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');

const BROWSERS = [
  // Windows
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
  // macOS
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  // Linux
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** Where the browser profiles live. */
export const defaultDataDir = (): string =>
  process.env['SHORTREADER_BRIDGE_DATA'] ??
  (process.platform === 'win32'
    ? path.join(localAppData, 'ShortReader', 'image-browser')
    : path.join(home, '.shortreader', 'image-browser'));

const browserPath = (): string => {
  const own = process.env['SHORTREADER_BROWSER'];
  if (own) {
    if (!existsSync(own)) throw new Error(`SHORTREADER_BROWSER does not exist: ${own}`);
    return own;
  }
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) {
    throw new Error(
      'Pictures are made in Microsoft Edge or Google Chrome; neither was found on this computer.',
    );
  }
  return exe;
};

export const createNodePlatform = (dataDir: string = defaultDataDir()): Platform => ({
  async launch(site: ImageProvider, url: string, port: number) {
    const profile = path.join(dataDir, `${site}-profile`);
    mkdirSync(profile, { recursive: true });
    spawn(
      browserPath(),
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        // Keeps the page working at full speed while its window is minimized
        // or behind others; a hidden tab is otherwise throttled to a crawl.
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        url,
      ],
      { detached: true, stdio: 'ignore' },
    ).unref();
  },

  async tabs(port: number) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, {
        signal: AbortSignal.timeout(1500),
      });
      return (await res.json()) as Tab[];
    } catch {
      return null;
    }
  },

  async openTab(port: number, url: string) {
    await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' });
  },

  async connect(tab: Tab): Promise<Connection> {
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error('Could not connect to the browser tab')));
    });
    let id = 0;
    return {
      send: (method, params = {}) =>
        new Promise((resolve, reject) => {
          const mine = ++id;
          const onMessage = (e: MessageEvent) => {
            const msg = JSON.parse(String(e.data)) as {
              id?: number;
              result?: Record<string, unknown>;
              error?: { message: string };
            };
            if (msg.id !== mine) return;
            ws.removeEventListener('message', onMessage);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result ?? {});
          };
          ws.addEventListener('message', onMessage);
          ws.send(JSON.stringify({ id: mine, method, params }));
        }),
      close: () => ws.close(),
    };
  },

  async download(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download the picture (${res.status})`);
    return {
      mimeType: res.headers.get('content-type')?.split(';')[0] || 'image/png',
      data: Buffer.from(await res.arrayBuffer()).toString('base64'),
    };
  },
});
