/**
 * Pictures (mind maps, visuals, comics, feed cards) come from Google Flow or
 * Grok Imagine — the reader's choice — made in a real browser window where the
 * reader signs in to their own account. Asking for a picture opens that window
 * if needed, waits while the reader signs in, then makes it by itself
 * (services/imagegen/core).
 *
 * Where the browser is driven from depends on where the app runs:
 * - desktop app: by the app itself;
 * - web app: by its own server route (/api/imagegen), on the reader's computer;
 * - phone: on Android, by default in a Flow / Grok window inside the app
 *   (imagegen/androidWindow), automatically once signed in there. Or, as the
 *   reader chooses: they paste the prompt in the Flow / Grok app or browser
 *   and add the picture (services/pictureHandoff), or the image bridge
 *   (tools/image-bridge) on a computer on the same network does it.
 */
import { getAIFetch } from '@/services/ai/utils/httpFetch';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';

import { getAIConfig, type ImageProviderId } from './byok/aiConfig';
import { openPictureSite, requestPictureHandoff } from './pictureHandoff';
import {
  PROVIDER_LABELS,
  makeImage,
  openSite,
  siteState,
  type ImageAspect,
  type MadeImage,
  type Progress,
  type SiteState,
} from './imagegen/core';

export type { ImageAspect };
export type ProviderState = SiteState;
export const IMAGE_PROVIDER_LABELS = PROVIDER_LABELS;

export type ImageRoute = 'desktop' | 'web' | 'bridge';

/** How this copy of the app makes pictures. */
export const imageRoute = (): ImageRoute => {
  if (isTauriAppPlatform()) {
    const os = getOSPlatform();
    return os === 'android' || os === 'ios' ? 'bridge' : 'desktop';
  }
  return isWebAppPlatform() ? 'web' : 'bridge';
};

const desktopPlatform = async () =>
  (await import('./imagegen/tauriPlatform')).createTauriPlatform();

// ---- Web: the app's own server route -------------------------------------------

const WEB_ROUTE = '/api/imagegen';

const webUnavailable = (status: number) =>
  status === 403 || status === 404
    ? 'Pictures need the web app running on your own computer (or the ShortReader desktop app).'
    : `Picture service error ${status}`;

async function webGenerate(
  provider: ImageProviderId,
  prompt: string,
  aspect: ImageAspect,
  onProgress: Progress,
): Promise<MadeImage> {
  const response = await fetch(WEB_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'generate', provider, prompt, aspect }),
  });
  if (!response.ok || !response.body) {
    const reply = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(reply.error || webUnavailable(response.status));
  }
  // NDJSON: status lines while it waits, then the image or an error.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffered += value;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { status?: string; image?: MadeImage; error?: string };
      if (event.status) onProgress(event.status);
      if (event.error) throw new Error(event.error);
      if (event.image) return event.image;
    }
    if (done) throw new Error('The picture service stopped before the picture was made');
  }
}

// ---- Phone: the image bridge on a computer ----------------------------------------

const BRIDGE_DOWN =
  'Pictures are made in a browser on a computer. Start the image bridge there (node tools/image-bridge/bridge.mjs) and put its address in Settings → AI Keys.';

async function bridgeCall<T>(path: string, body?: unknown): Promise<T> {
  const { bridgeUrl, bridgeToken } = getAIConfig();
  let response: Response;
  try {
    response = await getAIFetch()(`${bridgeUrl.replace(/\/+$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(bridgeToken ? { Authorization: `Bearer ${bridgeToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(BRIDGE_DOWN);
  }
  const reply = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(reply.error || `Image bridge ${response.status}`);
  return reply;
}

// ---- Public API -----------------------------------------------------------------

/** On a phone, whether pictures go through a computer's image bridge. */
const usesComputerBridge = (): boolean =>
  imageRoute() === 'bridge' && getAIConfig().phonePictures === 'computer';

/** On Android, whether pictures are made in the in-app window (the default). */
export const usesPictureWindow = (): boolean =>
  imageRoute() === 'bridge' &&
  getOSPlatform() === 'android' &&
  getAIConfig().phonePictures === 'phone';

const pictureWindow = () => import('./imagegen/androidWindow');

/** Pictures can be asked for: always, except a phone set to use a computer
 * with no bridge address. */
export const isImageGenConfigured = (): boolean =>
  !usesComputerBridge() || getAIConfig().bridgeUrl.trim().length > 0;

/** Each provider's window: closed, waiting for sign-in, or ready. */
export async function imageStatus(): Promise<Record<ImageProviderId, ProviderState>> {
  const route = imageRoute();
  if (route === 'desktop') {
    const platform = await desktopPlatform();
    return {
      flow: await siteState(platform, 'flow'),
      imagine: await siteState(platform, 'imagine'),
    };
  }
  if (route === 'web') {
    const response = await fetch(WEB_ROUTE);
    const reply = (await response.json().catch(() => ({}))) as Record<
      ImageProviderId,
      ProviderState
    > & { error?: string };
    if (!response.ok) throw new Error(reply.error || webUnavailable(response.status));
    return reply;
  }
  return bridgeCall('/status');
}

/** Open the provider's browser window, to sign in ahead of time. */
export async function openImageProvider(
  provider: ImageProviderId = getAIConfig().imageProvider,
): Promise<void> {
  const route = imageRoute();
  if (route === 'desktop') return openSite(await desktopPlatform(), provider);
  if (usesPictureWindow()) {
    await (await pictureWindow()).openPictureWindow(provider);
    return;
  }
  if (route === 'bridge' && !usesComputerBridge()) {
    await openPictureSite(provider, 'app');
    return;
  }
  if (route === 'web') {
    const response = await fetch(WEB_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', provider }),
    });
    if (!response.ok) {
      const reply = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(reply.error || webUnavailable(response.status));
    }
    return;
  }
  await bridgeCall('/open', { provider });
}

/**
 * Make one picture with the chosen provider; resolves to a data: URL. Opens
 * the provider's window and waits for the reader to sign in when needed,
 * reporting what it is waiting for through `onProgress`.
 */
export async function generateImage(
  prompt: string,
  aspect: ImageAspect = '16:9',
  onProgress: Progress = () => {},
): Promise<string> {
  const provider = getAIConfig().imageProvider;
  const route = imageRoute();
  let image: MadeImage;
  if (route === 'desktop') {
    image = await makeImage(await desktopPlatform(), provider, prompt, aspect, onProgress);
  } else if (route === 'web') {
    image = await webGenerate(provider, prompt, aspect, onProgress);
  } else if (usesPictureWindow()) {
    image = await (await pictureWindow()).makeImageInWindow(provider, prompt, aspect, onProgress);
  } else if (!usesComputerBridge()) {
    // The reader makes it in the Flow / Grok app and adds it; already a data: URL.
    return requestPictureHandoff(provider, prompt, aspect);
  } else {
    onProgress(
      `Making the picture in ${PROVIDER_LABELS[provider]} on your computer — sign in there if its window asks.`,
    );
    image = await bridgeCall<MadeImage>('/generate', { provider, prompt, aspect });
  }
  if (!image.data) throw new Error(`${PROVIDER_LABELS[provider]} returned no picture`);
  return `data:${image.mimeType || 'image/png'};base64,${image.data}`;
}
