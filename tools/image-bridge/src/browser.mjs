/**
 * A real browser driven over the DevTools protocol. Google refuses sign-in
 * inside embedded app windows, so Flow and Grok Imagine run in Microsoft Edge
 * or Google Chrome, launched with a profile of their own (the user's everyday
 * profile, passwords and cookies are never touched) and the protocol open on
 * a local port. The user signs in once per site; the profile keeps the session.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');

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

/** Where the bridge keeps its browser profiles. */
export const dataDir = () => {
  const dir =
    process.env.SHORTREADER_BRIDGE_DATA ??
    (process.platform === 'win32'
      ? path.join(localAppData, 'shortreader-image-bridge')
      : path.join(home, '.shortreader-image-bridge'));
  mkdirSync(dir, { recursive: true });
  return dir;
};

const browserPath = () => {
  const own = process.env.SHORTREADER_BROWSER;
  if (own) {
    if (!existsSync(own)) throw new Error(`SHORTREADER_BROWSER does not exist: ${own}`);
    return own;
  }
  const exe = BROWSERS.find((p) => existsSync(p));
  if (!exe) {
    throw new Error(
      'Microsoft Edge or Google Chrome is needed; set SHORTREADER_BROWSER to its path.',
    );
  }
  return exe;
};

/** A browser on its own DevTools port and profile. */
export class Browser {
  /** @param {{ port: number, profile: string }} opts */
  constructor({ port, profile }) {
    this.port = port;
    this.profile = profile;
  }

  /** The open tabs, or null when the browser is not running. */
  async tabs() {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/json`, {
        signal: AbortSignal.timeout(1500),
      });
      return /** @type {Tab[]} */ (await res.json());
    } catch {
      return null;
    }
  }

  /** Launch the browser at `url`, or open `url` in it when it's running. */
  async open(url, isWanted = () => false) {
    const open = await this.tabs();
    if (open) {
      const tab = open.find(isWanted);
      if (tab) await attach(tab, (send) => send('Page.bringToFront'));
      else await fetch(`http://127.0.0.1:${this.port}/json/new?${url}`, { method: 'PUT' });
      return;
    }
    spawn(
      browserPath(),
      [
        `--remote-debugging-port=${this.port}`,
        `--user-data-dir=${path.join(dataDir(), this.profile)}`,
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
  }
}

/**
 * @typedef {{ type: string, url: string, webSocketDebuggerUrl: string }} Tab
 * @typedef {(method: string, params?: Record<string, unknown>) => Promise<Record<string, any>>} Send
 */

/**
 * Attach to a tab for the length of `fn`.
 * @template T
 * @param {Tab} tab
 * @param {(send: Send) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const attach = async (tab, fn) => {
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('Could not connect to the browser tab')));
  });
  let id = 0;
  /** @type {Send} */
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mine = ++id;
      const onMessage = (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.id !== mine) return;
        ws.removeEventListener('message', onMessage);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result ?? {});
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id: mine, method, params }));
    });
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
};

/**
 * Run `expression` in the page and return its (awaited) value.
 * @template T
 * @param {Send} send
 * @param {string} expression
 * @returns {Promise<T>}
 */
export const evaluate = async (send, expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const raw =
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'Page script failed';
    throw new Error(raw.split('\n')[0].replace(/^Error: /, ''));
  }
  return r.result?.value;
};

/** A native mouse click: some buttons ignore clicks made by page script. */
export const clickAt = async (send, at) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: at.x,
    y: at.y,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: at.x,
    y: at.y,
    button: 'left',
    clickCount: 1,
  });
};

/** Runs one job at a time per site: the page can only make one picture at once. */
export const queue = () => {
  let lock = Promise.resolve();
  return (fn) => {
    const run = lock.catch(() => {}).then(fn);
    lock = run;
    return run;
  };
};
