/**
 * Pictures on Android, made by themselves: Google Flow or Grok Imagine opens
 * in a window inside ShortReader (native PictureWindow.kt), the reader signs
 * in there once, and this drives the page with the same page scripts as the
 * desktop app — real taps for the buttons that ignore scripted clicks, real
 * typing for editors that ignore scripted text.
 *
 * Google may refuse Google-account sign-in inside an app's window; then the
 * reader can switch to the hand-off or a computer in Settings → AI Keys.
 */
import { invoke } from '@tauri-apps/api/core';

import { getAIFetch } from '@/services/ai/utils/httpFetch';

import {
  FLOW_DRIVER,
  GROK_DRIVER,
  GROK_SIGNED_IN,
  IMAGE_ASPECTS,
  PROVIDER_LABELS,
  SITES,
  type ImageAspect,
  type ImageProvider,
  type MadeImage,
  type Progress,
} from './core';

const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

interface WindowReply {
  json?: string;
  url?: string;
  open?: boolean;
  typed?: boolean;
}

const call = (payload: Record<string, unknown>) =>
  invoke<WindowReply>('plugin:native-bridge|picture_window', { payload });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The page scripts are expressions; a trailing semicolon would break `await (…)`. */
const asExpression = (script: string) => script.trim().replace(/;$/, '');

async function evaluate<T>(expression: string): Promise<T> {
  const reply = await call({ action: 'eval', expression: asExpression(expression) });
  const result = JSON.parse(reply.json ?? '{}') as { ok?: boolean; value?: T; error?: string };
  if (!result.ok) throw new Error(result.error || 'Page script failed');
  return result.value as T;
}

async function tap(at: { x: number; y: number }) {
  const viewportWidth = await evaluate<number>('window.innerWidth');
  await call({ action: 'tap', x: at.x, y: at.y, viewportWidth });
}

/** Key events only exist for plain characters: fold the rest. */
const asciiFold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\n]/g, '');

/** Type into the focused editor: as script first, as key presses if the
 * editor ignored it. */
async function typePrompt(prompt: string) {
  const typed = await evaluate<boolean>(`(() => {
    const el = document.activeElement;
    document.execCommand('insertText', false, ${JSON.stringify(prompt)});
    return !!el && ((el.innerText || el.value || '').trim().length > 0);
  })()`);
  if (typed) return;
  const reply = await call({ action: 'type', text: asciiFold(prompt) });
  if (!reply.typed) throw new Error('Could not type the prompt into the page');
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

async function download(url: string): Promise<MadeImage> {
  const res = await getAIFetch()(url);
  if (!res.ok) throw new Error(`Could not download the picture (${res.status})`);
  return {
    mimeType: res.headers.get('content-type')?.split(';')[0] || 'image/png',
    data: toBase64(new Uint8Array(await res.arrayBuffer())),
  };
}

/** Open the window (to sign in ahead of time). */
export async function openPictureWindow(provider: ImageProvider): Promise<void> {
  await call({
    action: 'open',
    url: SITES[provider].url,
    title: `Sign in to ${PROVIDER_LABELS[provider]} here once; pictures are then made by themselves.`,
  });
}

/** Wait until the page can make a picture; opens a Flow project by itself. */
async function waitUntilReady(provider: ImageProvider, status: (text: string) => void) {
  const label = PROVIDER_LABELS[provider];
  const started = Date.now();
  let askedToSignIn = false;
  let warnedGoogle = false;
  while (Date.now() - started < SIGN_IN_TIMEOUT_MS) {
    const state = await call({ action: 'state' });
    if (state.open === false) throw new Error('The picture window was closed.');
    const url = state.url ?? '';
    if (provider === 'flow') {
      if (url.includes('flow.google.com/project/')) return;
      if (url.startsWith('https://flow.google.com')) {
        const at = await evaluate<{ x: number; y: number } | null>(
          `(${asExpression(FLOW_DRIVER)}, window.__shortreader.startProject())`,
        ).catch(() => null);
        if (at) {
          status('Opening a Flow project…');
          await tap(at);
          await sleep(4000);
          continue;
        }
      }
      if (url.startsWith('https://accounts.google.com') && !warnedGoogle) {
        warnedGoogle = true;
        status(
          'Sign in to Google. If Google says this browser isn’t allowed, close this window and pick another way in Settings → AI Keys → Pictures.',
        );
      }
    } else {
      const onImagine = /^https:\/\/grok\.com\/imagine/.test(url);
      const signedIn = /^https:\/\/grok\.com/.test(url)
        ? await evaluate<boolean>(GROK_SIGNED_IN).catch(() => false)
        : false;
      if (onImagine && signedIn) return;
      if (signedIn && !onImagine) {
        await evaluate(`location.assign(${JSON.stringify(SITES.imagine.url)})`).catch(() => {});
        await sleep(3000);
        continue;
      }
    }
    if (!askedToSignIn) {
      askedToSignIn = true;
      if (!warnedGoogle) {
        status(`Sign in to ${label} here once. The picture starts by itself when you’re in.`);
      }
    }
    await sleep(2500);
  }
  throw new Error(`Timed out waiting for you to sign in to ${label}.`);
}

let queue: Promise<unknown> = Promise.resolve();

/** Make one picture in the in-app window; opens it and waits for sign-in. */
export function makeImageInWindow(
  provider: ImageProvider,
  prompt: string,
  aspect: ImageAspect = '16:9',
  onProgress: Progress = () => {},
): Promise<MadeImage> {
  if (!prompt.trim()) return Promise.reject(new Error('A prompt is needed'));
  if (!IMAGE_ASPECTS.includes(aspect)) {
    return Promise.reject(new Error(`Aspect must be one of ${IMAGE_ASPECTS.join(', ')}`));
  }
  const label = PROVIDER_LABELS[provider];
  const status = (text: string) => {
    onProgress(text);
    void call({ action: 'status', text }).catch(() => {});
  };
  const run = queue
    .catch(() => {})
    .then(async () => {
      await call({ action: 'open', url: SITES[provider].url, title: `Opening ${label}…` });
      try {
        await waitUntilReady(provider, status);
        status(`Making the picture in ${label}…`);
        let image: MadeImage;
        if (provider === 'flow') {
          await evaluate(FLOW_DRIVER);
          const at = await evaluate<{ x: number; y: number }>(
            `window.__shortreader.prepare(${JSON.stringify({ prompt: prompt.trim(), aspect })})`,
          );
          await tap(at);
          image = await download(await evaluate<string>('window.__shortreader.waitForImage()'));
        } else {
          await evaluate(GROK_DRIVER);
          const box = await evaluate<{ x: number; y: number }>(
            `window.__srGrok.prepare(${JSON.stringify({ aspect })})`,
          );
          await tap(box);
          await typePrompt(prompt.trim());
          await sleep(500);
          await tap(await evaluate<{ x: number; y: number }>('window.__srGrok.submitAt()'));
          const data = await evaluate<string>('window.__srGrok.waitForImage()');
          image = { mimeType: 'image/jpeg', data };
        }
        // Out of sight but still signed in and loaded for the next picture.
        await call({ action: 'hide' }).catch(() => {});
        return image;
      } catch (e) {
        // A CAPTCHA needs the reader: leave the window up for it.
        if (!(e instanceof Error && /CAPTCHA/.test(e.message))) {
          await call({ action: 'hide' }).catch(() => {});
        }
        throw e;
      }
    });
  queue = run;
  return run;
}
