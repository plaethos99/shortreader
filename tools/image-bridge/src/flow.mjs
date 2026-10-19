/**
 * Google Flow (flow.google.com). Flow has no public API, so the bridge opens
 * it in its own browser window, where the user is signed in, and injects
 * FLOW_DRIVER. One picture takes three steps:
 *
 *   1. `__shortreader.prepare({prompt, aspect})` picks Image, the aspect ratio
 *      and one picture, types the prompt and returns where the generate button
 *      is (CSS pixels);
 *   2. the bridge clicks there with a native input event — Flow ignores clicks
 *      made by page script on that button;
 *   3. `__shortreader.waitForImage()` resolves to the new picture's URL.
 *
 * It works the page the way a person would, at a person's pace. If Flow shows
 * a CAPTCHA challenge it stops and reports it, for the user to answer — it
 * never tries to get around one.
 *
 * Tied to Flow's current page: the prompt box is labelled "What do you want to
 * create?", the generate button "Start generation", the settings button
 * "Settings trigger", and mode, aspect and count are radio buttons in its
 * popover; Agent mode is a chip labelled "Agent" with aria-pressed. When Flow
 * changes those, this is the one place to update.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { Browser, attach, clickAt, dataDir, evaluate, queue } from './browser.mjs';

const FLOW_URL = 'https://flow.google.com/';
const browser = new Browser({
  port: Number(process.env.SHORTREADER_FLOW_PORT ?? 9434),
  profile: 'flow-profile',
});

const FLOW_DRIVER = `(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const radios = () => [...document.querySelectorAll('button[role="radio"]')];
  const pick = (label) => radios().find((b) => b.innerText.trim().split('\\n').pop().trim() === label);
  const challenge = () =>
    [...document.querySelectorAll('iframe')].some((f) => /recaptcha/.test(f.src) && /bframe|challenge/.test(f.src + f.title) && f.offsetHeight > 50);
  const imageKey = (src) => (src.split('/image/')[1] || src).split('?')[0];
  // Refused generations show as error tiles ("might violate our policies").
  const errorTiles = () => [...document.querySelectorAll('flow-error-tile, .error-tile')];
  let beforeErrors = 0;
  const refusal = () => {
    const tiles = errorTiles();
    if (tiles.length <= beforeErrors) return null;
    const text = tiles[0].textContent || '';
    return /polic|violat|safety|guideline/i.test(text) ? 'POLICY: Flow refused the picture: it might break Google’s policies' : 'Flow failed to make it: ' + text.slice(0, 160);
  };

  // Sets the popover's radio options in order (a mode first: later options
  // depend on it), opening the popover if needed and closing it after.
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

  // In Agent mode a prompt goes to Flow's chat agent, not straight to the
  // image model, and the aspect and count options are gone.
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

  window.__shortreader = { prepare, waitForImage };
  return 'ready';
})()`;

const isProject = (t) => t.type === 'page' && t.url.includes('flow.google.com/project/');

// The last Flow project used, so a relaunched browser reopens straight into it.
const lastProjectFile = () => path.join(dataDir(), 'flow-last-project.txt');
const lastProject = () => {
  try {
    const url = readFileSync(lastProjectFile(), 'utf8').trim();
    return /^https:\/\/flow\.google\.com\/project\//.test(url) ? url : null;
  } catch {
    return null;
  }
};

/** Open Flow in its browser window (launching it if it isn't running). */
export const openFlow = () => browser.open(lastProject() ?? FLOW_URL, isProject);

/** closed: no window; signin: open but no project yet; ready. */
export const flowState = async () => {
  const open = await browser.tabs();
  if (!open) return 'closed';
  return open.some(isProject) ? 'ready' : 'signin';
};

const oneAtATime = queue();

/** Make one picture in Flow; resolves to its bytes. */
export const flowImage = (prompt, aspect) =>
  oneAtATime(async () => {
    const tab = (await browser.tabs())?.find(isProject);
    if (!tab) {
      throw new Error(
        'Open Flow, sign in, and open a project (New project) in the Flow browser window first.',
      );
    }
    writeFileSync(lastProjectFile(), tab.url.split('?')[0]);
    const url = await attach(tab, async (send) => {
      // A tab in the background has its timers throttled; Flow needs it awake.
      await send('Page.bringToFront');
      await evaluate(send, FLOW_DRIVER);
      const at = await evaluate(
        send,
        `window.__shortreader.prepare(${JSON.stringify({ prompt, aspect })})`,
      );
      await clickAt(send, at);
      return evaluate(send, 'window.__shortreader.waitForImage()');
    });
    // Flow serves pictures from signed links that need no cookies.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not download the picture from Flow (${res.status})`);
    return {
      mimeType: res.headers.get('content-type')?.split(';')[0] || 'image/png',
      data: Buffer.from(await res.arrayBuffer()),
    };
  });
