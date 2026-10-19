/**
 * Grok Imagine (grok.com/imagine), in a real browser the same way as Google
 * Flow: its own profile and the DevTools protocol on a local port. The user
 * signs in to their Grok account there once; the profile keeps the session.
 *
 *   1. `__srGrok.prepare({aspect})` picks Image, Quality and the aspect ratio
 *      (the image count is left as set in Grok; the first picture is used),
 *      empties the prompt box, and returns where the box is (the bridge
 *      clicks it and types the prompt through the protocol, which the editor
 *      takes as real typing).
 *   2. `__srGrok.submitAt()` returns where the Submit button is (clicked natively).
 *   3. `__srGrok.waitForImage()` waits for the first new finished picture and
 *      returns it as base64 JPEG. While generating, Grok shows small noisy
 *      PNG previews; finished pictures are full-size JPEGs embedded in the page.
 *
 * Everything is found by its label or what it says, not by class names.
 */
import { Browser, attach, clickAt, evaluate, queue } from './browser.mjs';

const GROK_URL = 'https://grok.com/imagine';
const browser = new Browser({
  port: Number(process.env.SHORTREADER_GROK_PORT ?? 9460),
  profile: 'grok-profile',
});

const GROK_DRIVER = `(() => {
  if (window.__srGrok) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (e) => e.offsetParent !== null;
  const button = (label) => [...document.querySelectorAll('button')].filter(visible).find((b) => b.getAttribute('aria-label') === label || b.innerText.trim() === label);
  const options = () => [...document.querySelectorAll('[role=menuitemradio],[role=menuitem],[role=option],[role=radio]')].filter(visible);
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // Our aspect ratios, as Grok names them.
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
    if (!o) {
      escape();
      await sleep(300);
      return false;
    }
    o.click();
    await sleep(400);
    return true;
  }

  async function prepare({ aspect }) {
    const box = [...document.querySelectorAll('[contenteditable=true]')].filter(visible).pop();
    if (!box) throw new Error('Grok Imagine page not ready: no prompt box (sign in, and open grok.com/imagine)');
    before = new Set(finals().map((i) => keyOf(i.src)));
    beforeText = document.body.innerText;
    // Pictures, at the better quality, in our aspect.
    button('Image')?.click();
    await sleep(300);
    const quality = [...document.querySelectorAll('button')].filter(visible).find((b) => /^Quality/.test(b.innerText.trim()));
    if (quality && quality.getAttribute('aria-pressed') !== 'true') quality.click();
    await sleep(300);
    const want = ASPECT[aspect] || '16:9';
    if (!(await choose('Aspect Ratio', (t) => t.startsWith(want)))) throw new Error('Grok Imagine has no ' + want + ' aspect ratio');
    // Empty the box.
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
      // A refusal: words about moderation that weren't on the page before.
      const text = document.body.innerText;
      if (text.length !== beforeText.length && /moderat|violat|not allowed|can.t generate|unable to generate|content polic/i.test(text.slice(-4000)) && !/moderat|violat|not allowed|content polic/i.test(beforeText.slice(-4000)))
        throw new Error('POLICY: Grok Imagine refused the picture');
    }
    throw new Error('Grok Imagine did not return a picture in time');
  }

  window.__srGrok = { prepare, submitAt, waitForImage };
})();`;

const isImagine = (t) => t.type === 'page' && /^https:\/\/grok\.com\/imagine/.test(t.url);

/** Open Grok Imagine in its browser window (launching it if it isn't running). */
export const openGrok = () => browser.open(GROK_URL, isImagine);

// Signed in when the page has the prompt box and no "Sign in" button.
const GROK_SIGNED_IN = `(() => {
  const signIn = [...document.querySelectorAll('a,button')].some((b) => /^\\s*sign (in|up)\\s*$/i.test(b.textContent || ''));
  const box = document.querySelector('textarea, [contenteditable="true"]');
  return !!box && !signIn;
})()`;

/** closed: no window; signin: open but not on Imagine signed in; ready. */
export const grokState = async () => {
  const open = await browser.tabs();
  if (!open) return 'closed';
  const tab = open.find(isImagine);
  if (!tab) return 'signin';
  try {
    const signedIn = await attach(tab, (send) => evaluate(send, GROK_SIGNED_IN));
    return signedIn ? 'ready' : 'signin';
  } catch {
    return 'signin';
  }
};

const oneAtATime = queue();

/** Make one picture in Grok Imagine; resolves to its bytes. */
export const grokImage = (prompt, aspect) =>
  oneAtATime(async () => {
    const tab = (await browser.tabs())?.find(isImagine);
    if (!tab) throw new Error('Open Grok Imagine and sign in first.');
    return attach(tab, async (send) => {
      await send('Page.bringToFront');
      await evaluate(send, GROK_DRIVER);
      const box = await evaluate(send, `window.__srGrok.prepare(${JSON.stringify({ aspect })})`);
      // Typed through the protocol, so the editor takes it as real typing.
      await clickAt(send, box);
      await send('Input.insertText', { text: prompt });
      await new Promise((r) => setTimeout(r, 500));
      await clickAt(send, await evaluate(send, 'window.__srGrok.submitAt()'));
      const b64 = await evaluate(send, 'window.__srGrok.waitForImage()');
      return { mimeType: 'image/jpeg', data: Buffer.from(b64, 'base64') };
    });
  });
