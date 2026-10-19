/**
 * Making a picture in Google Flow or Grok Imagine, the way a person would.
 *
 * Neither has a public API for this, so the picture is made in a real browser
 * window (Edge or Chrome, with a profile of its own) where the reader signs in
 * to their own account. This engine:
 *
 *   1. opens the site's window if it isn't open;
 *   2. waits while the reader signs in — for Flow it then opens a project by
 *      itself (New project) — reporting what it is waiting for;
 *   3. types the prompt, presses generate with a native click (Flow ignores
 *      scripted clicks on it), and waits for the new picture.
 *
 * It talks to the browser over the DevTools protocol through a Platform: the
 * desktop app (Tauri), the web app's own server route, or the image bridge
 * (tools/image-bridge) each supply one. Self-contained — no imports, only
 * erasable TypeScript — so the bridge can run this file with plain Node.
 *
 * If Flow shows a CAPTCHA it stops and says so, for the reader to answer — it
 * never tries to get around one.
 */

export type ImageProvider = 'flow' | 'imagine';
export type ImageAspect = '16:9' | '9:16' | '4:3' | '3:4' | '1:1';
export const IMAGE_ASPECTS: ImageAspect[] = ['16:9', '9:16', '4:3', '3:4', '1:1'];

export interface Tab {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface Connection {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
}

/** What the engine needs from where it runs. */
export interface Platform {
  /** Start the site's browser window at `url` (DevTools on `port`, own profile). */
  launch: (site: ImageProvider, url: string, port: number) => Promise<void>;
  /** The browser's open tabs, or null when it isn't running. */
  tabs: (port: number) => Promise<Tab[] | null>;
  /** Open a new tab at `url` in the running browser. */
  openTab: (port: number, url: string) => Promise<void>;
  connect: (tab: Tab) => Promise<Connection>;
  /** Download a picture by URL (Flow serves signed links that need no cookies). */
  download: (url: string) => Promise<{ mimeType: string; data: string }>;
  sleep?: (ms: number) => Promise<void>;
}

export interface MadeImage {
  mimeType: string;
  /** Base64. */
  data: string;
}

export type Progress = (status: string) => void;

export const PROVIDER_LABELS: Record<ImageProvider, string> = {
  flow: 'Google Flow',
  imagine: 'Grok Imagine',
};

// How long to wait for the reader to sign in before giving up.
const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

const wait = (platform: Platform, ms: number) =>
  platform.sleep ? platform.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms));

// ---- DevTools helpers ------------------------------------------------------------

async function evaluate<T>(conn: Connection, expression: string): Promise<T> {
  const r = (await conn.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })) as {
    result?: { value?: T };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  };
  if (r.exceptionDetails) {
    const raw =
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'Page script failed';
    throw new Error(raw.split('\n')[0]!.replace(/^Error: /, ''));
  }
  return r.result?.value as T;
}

async function clickAt(conn: Connection, at: { x: number; y: number }) {
  const base = { x: at.x, y: at.y, button: 'left', clickCount: 1 };
  await conn.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
  await conn.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await conn.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
}

async function withTab<T>(
  platform: Platform,
  tab: Tab,
  fn: (conn: Connection) => Promise<T>,
): Promise<T> {
  const conn = await platform.connect(tab);
  try {
    return await fn(conn);
  } finally {
    conn.close();
  }
}

// ---- Page drivers ----------------------------------------------------------------
// Found by label or text, not class names. When a site redesigns its page,
// these scripts are the one place to update.

/** Flow (flow.google.com). `prepare` sets Image, aspect, x1 and types the prompt,
 * returning where the generate button is; `waitForImage` returns the new
 * picture's URL; `startProject` clicks "New project" once signed in. */
const FLOW_DRIVER = `(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const radios = () => [...document.querySelectorAll('button[role="radio"]')];
  const pick = (label) => radios().find((b) => b.innerText.trim().split('\\n').pop().trim() === label);
  const challenge = () =>
    [...document.querySelectorAll('iframe')].some((f) => /recaptcha/.test(f.src) && /bframe|challenge/.test(f.src + f.title) && f.offsetHeight > 50);
  const imageKey = (src) => (src.split('/image/')[1] || src).split('?')[0];
  const visible = (e) => e.offsetParent !== null;
  // Refused generations show as error tiles ("might violate our policies").
  const errorTiles = () => [...document.querySelectorAll('flow-error-tile, .error-tile')];
  let beforeErrors = 0;
  const refusal = () => {
    const tiles = errorTiles();
    if (tiles.length <= beforeErrors) return null;
    const text = tiles[0].textContent || '';
    return /polic|violat|safety|guideline/i.test(text) ? 'Flow refused the picture: it might break Google’s policies' : 'Flow failed to make it: ' + text.slice(0, 160);
  };

  async function setOptions(labels) {
    const trigger = document.querySelector('button[aria-label="Settings trigger"]');
    if (!trigger) throw new Error('Flow page not ready: no settings button');
    if (!pick(labels[0])) { trigger.click(); await sleep(700); }
    for (const label of labels) {
      const b = pick(label);
      if (!b) throw new Error('Flow has no option ' + label);
      if (b.getAttribute('aria-checked') !== 'true') { b.click(); await sleep(400); }
    }
    if (pick(labels[0])) { trigger.click(); await sleep(400); }
  }

  async function typePrompt(text) {
    const box = document.querySelector('[role="textbox"][contenteditable="true"][aria-label*="create"]');
    if (!box) throw new Error('Flow page not ready: no prompt box');
    box.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, text);
    await sleep(500);
    if (!box.innerText.trim()) throw new Error('Could not type the prompt into Flow');
  }

  // In Agent mode a prompt goes to Flow's chat agent, not the image model.
  async function agentOff() {
    const chip = [...document.querySelectorAll('button')].find(
      (b) => b.innerText.trim() === 'Agent' && b.getAttribute('aria-pressed') === 'true',
    );
    if (!chip) return;
    chip.click();
    await sleep(600);
    if (chip.getAttribute('aria-pressed') === 'true') throw new Error('Turn off "Agent" in the Flow prompt bar');
  }

  let before = new Set();

  async function prepare({ prompt, aspect }) {
    if (challenge()) throw new Error('CAPTCHA: Flow is asking for a check — answer it in the Flow window');
    before = new Set([...document.querySelectorAll('img')].map((i) => imageKey(i.src)));
    beforeErrors = errorTiles().length;
    await agentOff();
    await setOptions(['Image', aspect, 'x1']);
    await typePrompt(prompt);
    const go = document.querySelector('button[aria-label="Start generation"]');
    if (!go) throw new Error('Flow page not ready: no generate button');
    const r = go.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  async function waitForImage(timeoutMs = 180000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(2000);
      if (challenge()) throw new Error('CAPTCHA: Flow is asking for a check — answer it in the Flow window');
      const refused = refusal();
      if (refused) throw new Error(refused);
      const img = [...document.querySelectorAll('img')].find(
        (i) => i.naturalWidth > 300 && i.src.includes('/image/') && !before.has(imageKey(i.src)),
      );
      if (img) return img.src;
    }
    throw new Error('Flow did not return an image in time');
  }

  // Signed in, Flow's home page offers "New project": open one. Returns
  // whether there was one to press (not yet signed in otherwise).
  function startProject() {
    const b = [...document.querySelectorAll('button, a')].filter(visible).find((e) => /^\\s*(\\+\\s*)?new project\\s*$/i.test(e.innerText || e.getAttribute('aria-label') || ''));
    if (!b) return false;
    b.click();
    return true;
  }

  window.__shortreader = { prepare, waitForImage, startProject };
  return 'ready';
})()`;

/** Grok Imagine (grok.com/imagine). `prepare` picks Image, Quality and the
 * aspect and empties the prompt box, returning where it is (the prompt is
 * typed through the protocol); `submitAt` is the Submit button; `waitForImage`
 * returns the first new full-size picture as base64 JPEG. */
const GROK_DRIVER = `(() => {
  if (window.__srGrok) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => e.offsetParent !== null;
  const button = (label) => [...document.querySelectorAll('button')].filter(visible).find((b) => b.getAttribute('aria-label') === label || b.innerText.trim() === label);
  const options = () => [...document.querySelectorAll('[role=menuitemradio],[role=menuitem],[role=option],[role=radio]')].filter(visible);
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const ASPECT = { '16:9': '16:9', '9:16': '9:16', '4:3': '3:2', '3:4': '2:3', '1:1': '1:1', '3:2': '3:2', '2:3': '2:3' };
  // A finished picture: a full-size embedded JPEG. Data URLs share their
  // header, so one is known by its length and its end.
  const finals = () => [...document.querySelectorAll('img')].filter((i) => i.src.startsWith('data:image/jpeg') && i.naturalWidth >= 600);
  const keyOf = (src) => src.length + ':' + src.slice(-80);
  let before = new Set();
  let beforeText = '';

  async function choose(label, match) {
    const b = button(label);
    if (!b) return false;
    b.click();
    await sleep(600);
    const o = options().find((e) => match(e.innerText.trim()));
    if (!o) { escape(); await sleep(300); return false; }
    o.click();
    await sleep(400);
    return true;
  }

  async function prepare({ aspect }) {
    const box = [...document.querySelectorAll('[contenteditable=true]')].filter(visible).pop();
    if (!box) throw new Error('Grok Imagine page not ready: no prompt box');
    before = new Set(finals().map((i) => keyOf(i.src)));
    beforeText = document.body.innerText;
    button('Image')?.click();
    await sleep(300);
    const quality = [...document.querySelectorAll('button')].filter(visible).find((b) => /^Quality/.test(b.innerText.trim()));
    if (quality && quality.getAttribute('aria-pressed') !== 'true') quality.click();
    await sleep(300);
    const want = ASPECT[aspect] || '16:9';
    if (!(await choose('Aspect Ratio', (t) => t.startsWith(want)))) throw new Error('Grok Imagine has no ' + want + ' aspect ratio');
    box.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    const r = box.getBoundingClientRect();
    return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) };
  }

  function submitAt() {
    const go = button('Submit');
    if (!go) throw new Error('Grok Imagine page not ready: no Submit button');
    const r = go.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  async function waitForImage(timeoutMs = 300000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const fresh = finals().filter((i) => !before.has(keyOf(i.src)));
      if (fresh.length) {
        await sleep(1500);
        const pic = finals().find((i) => !before.has(keyOf(i.src))) || fresh[0];
        return pic.src.slice(pic.src.indexOf(',') + 1);
      }
      const text = document.body.innerText;
      if (text.length !== beforeText.length && /moderat|violat|not allowed|can.t generate|unable to generate|content polic/i.test(text.slice(-4000)) && !/moderat|violat|not allowed|content polic/i.test(beforeText.slice(-4000)))
        throw new Error('Grok Imagine refused the picture');
    }
    throw new Error('Grok Imagine did not return a picture in time');
  }

  window.__srGrok = { prepare, submitAt, waitForImage };
})();`;

// Signed in when the page has a prompt box and no "Sign in" button.
const GROK_SIGNED_IN = `(() => {
  const signIn = [...document.querySelectorAll('a,button')].some((b) => /^\\s*sign (in|up)\\s*$/i.test(b.textContent || ''));
  const box = document.querySelector('textarea, [contenteditable="true"]');
  return !!box && !signIn;
})()`;

// ---- Sites -----------------------------------------------------------------------

interface Site {
  url: string;
  port: number;
  /** A tab where pictures can be made right away. */
  isReady: (tab: Tab) => boolean;
  /** A tab on the site at all (signing in, or its home page). */
  isSite: (tab: Tab) => boolean;
}

export const SITES: Record<ImageProvider, Site> = {
  flow: {
    url: 'https://flow.google.com/',
    port: 9434,
    isReady: (t) => t.type === 'page' && t.url.includes('flow.google.com/project/'),
    // Google's sign-in pages count: the reader is on their way in.
    isSite: (t) =>
      t.type === 'page' &&
      /^https:\/\/(flow\.google\.com|labs\.google|accounts\.google\.com)/.test(t.url),
  },
  imagine: {
    url: 'https://grok.com/imagine',
    port: 9460,
    isReady: (t) => t.type === 'page' && /^https:\/\/grok\.com\/imagine/.test(t.url),
    isSite: (t) =>
      t.type === 'page' &&
      /^https:\/\/(grok\.com|accounts\.x\.ai|x\.com|accounts\.google\.com|appleid\.apple\.com)/.test(
        t.url,
      ),
  },
};

export type SiteState = 'closed' | 'signin' | 'ready';

/** Whether the site's window is closed, waiting for sign-in, or ready. */
export async function siteState(platform: Platform, provider: ImageProvider): Promise<SiteState> {
  const site = SITES[provider];
  const tabs = await platform.tabs(site.port);
  if (!tabs) return 'closed';
  const tab = tabs.find(site.isReady);
  if (!tab) return 'signin';
  if (provider === 'flow') return 'ready';
  try {
    const signedIn = await withTab(platform, tab, (c) => evaluate<boolean>(c, GROK_SIGNED_IN));
    return signedIn ? 'ready' : 'signin';
  } catch {
    return 'signin';
  }
}

/** Open the site's window, or bring it forward. */
export async function openSite(platform: Platform, provider: ImageProvider): Promise<void> {
  const site = SITES[provider];
  const tabs = await platform.tabs(site.port);
  if (!tabs) return platform.launch(provider, site.url, site.port);
  const tab = tabs.find(site.isReady) ?? tabs.find(site.isSite);
  if (tab) await withTab(platform, tab, (c) => c.send('Page.bringToFront'));
  else await platform.openTab(site.port, site.url);
}

/**
 * Wait until a picture can be made: the window open, the reader signed in, and
 * (for Flow) a project open. Opens the window, and Flow's project, by itself.
 */
async function waitUntilReady(
  platform: Platform,
  provider: ImageProvider,
  onProgress: Progress,
  signal?: AbortSignal,
): Promise<Tab> {
  const site = SITES[provider];
  const label = PROVIDER_LABELS[provider];
  const started = Date.now();
  let announced = false;
  while (Date.now() - started < SIGN_IN_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error('Cancelled');
    const tabs = await platform.tabs(site.port);
    if (!tabs) {
      onProgress(`Opening ${label}…`);
      await platform.launch(provider, site.url, site.port);
      await wait(platform, 3000);
      continue;
    }
    const ready = tabs.find(site.isReady);
    if (ready) {
      if (provider === 'flow') return ready;
      const signedIn = await withTab(platform, ready, (c) =>
        evaluate<boolean>(c, GROK_SIGNED_IN),
      ).catch(() => false);
      if (signedIn) return ready;
    }
    if (provider === 'flow') {
      // Signed in on Flow's home page: open a project.
      const home = tabs.find(
        (t) => t.type === 'page' && t.url.startsWith('https://flow.google.com'),
      );
      if (home) {
        const opened = await withTab(platform, home, async (c) => {
          await evaluate(c, FLOW_DRIVER);
          return evaluate<boolean>(c, 'window.__shortreader.startProject()');
        }).catch(() => false);
        if (opened) {
          onProgress('Opening a Flow project…');
          await wait(platform, 4000);
          continue;
        }
      }
    }
    // The reader closed the site's tab: open it again.
    if (!tabs.some(site.isSite)) await platform.openTab(site.port, site.url);
    if (!announced) {
      onProgress(
        `Sign in to ${label} in the browser window that opened. The picture starts by itself once you are in.`,
      );
      announced = true;
    }
    await wait(platform, 2500);
  }
  throw new Error(`Timed out waiting for you to sign in to ${label}.`);
}

// One picture at a time per site: its page can only make one at once.
const queues: Partial<Record<ImageProvider, Promise<unknown>>> = {};
const oneAtATime = <T>(provider: ImageProvider, fn: () => Promise<T>): Promise<T> => {
  const run = (queues[provider] ?? Promise.resolve()).catch(() => {}).then(fn);
  queues[provider] = run;
  return run;
};

/** Make one picture with `provider`; opens it and waits for sign-in as needed. */
export function makeImage(
  platform: Platform,
  provider: ImageProvider,
  prompt: string,
  aspect: ImageAspect = '16:9',
  onProgress: Progress = () => {},
  signal?: AbortSignal,
): Promise<MadeImage> {
  if (!SITES[provider]) {
    return Promise.reject(new Error(`Unknown picture provider "${provider}"`));
  }
  if (!prompt.trim()) return Promise.reject(new Error('A prompt is needed'));
  if (!IMAGE_ASPECTS.includes(aspect)) {
    return Promise.reject(new Error(`Aspect must be one of ${IMAGE_ASPECTS.join(', ')}`));
  }
  return oneAtATime(provider, async () => {
    const tab = await waitUntilReady(platform, provider, onProgress, signal);
    const label = PROVIDER_LABELS[provider];
    onProgress(`Making the picture in ${label}…`);
    if (provider === 'flow') {
      const url = await withTab(platform, tab, async (c) => {
        // A tab in the background has its timers throttled; Flow needs it awake.
        await c.send('Page.bringToFront');
        await evaluate(c, FLOW_DRIVER);
        const at = await evaluate<{ x: number; y: number }>(
          c,
          `window.__shortreader.prepare(${JSON.stringify({ prompt: prompt.trim(), aspect })})`,
        );
        await clickAt(c, at);
        return evaluate<string>(c, 'window.__shortreader.waitForImage()');
      });
      return platform.download(url);
    }
    const data = await withTab(platform, tab, async (c) => {
      await c.send('Page.bringToFront');
      await evaluate(c, GROK_DRIVER);
      const box = await evaluate<{ x: number; y: number }>(
        c,
        `window.__srGrok.prepare(${JSON.stringify({ aspect })})`,
      );
      // Typed through the protocol, so the editor takes it as real typing.
      await clickAt(c, box);
      await c.send('Input.insertText', { text: prompt.trim() });
      await wait(platform, 500);
      await clickAt(c, await evaluate<{ x: number; y: number }>(c, 'window.__srGrok.submitAt()'));
      return evaluate<string>(c, 'window.__srGrok.waitForImage()');
    });
    return { mimeType: 'image/jpeg', data };
  });
}
