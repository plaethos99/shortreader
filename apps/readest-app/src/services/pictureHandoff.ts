/**
 * Pictures on a phone, made by the reader in the Google Flow or Grok app (or
 * the website). A phone can't run the browser window the desktop app drives,
 * so instead ShortReader hands off: it copies the prompt, opens Flow / Grok in
 * the app or the browser — the reader's choice — and takes the finished
 * picture back from the phone's gallery (PictureHandoffDialog).
 */
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { getOSPlatform } from '@/utils/misc';

import type { ImageProviderId } from './byok/aiConfig';
import type { ImageAspect } from './imagegen/core';

export interface PictureSite {
  label: string;
  appLabel: string;
  url: string;
  // The Android app, opened by package name when the reader picks "app".
  androidPackage: string;
}

export const PICTURE_SITES: Record<ImageProviderId, PictureSite> = {
  flow: {
    label: 'Google Flow',
    appLabel: 'Flow app',
    url: 'https://flow.google.com/',
    // Flow's Android app kept the package of Whisk, which it absorbed.
    androidPackage: 'com.google.android.apps.labs.whisk',
  },
  imagine: {
    label: 'Grok Imagine',
    appLabel: 'Grok app',
    url: 'https://grok.com/imagine',
    androidPackage: 'ai.x.grok',
  },
};

export const ASPECT_WORDS: Record<ImageAspect, string> = {
  '16:9': 'landscape (16:9)',
  '9:16': 'portrait (9:16)',
  '4:3': 'landscape (4:3)',
  '3:4': 'portrait (3:4)',
  '1:1': 'square (1:1)',
};

export interface PictureHandoffRequest {
  provider: ImageProviderId;
  prompt: string;
  aspect: ImageAspect;
  resolve: (dataUrl: string) => void;
  reject: (error: Error) => void;
}

export const PICTURE_HANDOFF_EVENT = 'show-picture-handoff';

/** Ask the reader to make the picture in Flow / Grok and add it; resolves to
 * the picture as a data: URL. */
export const requestPictureHandoff = (
  provider: ImageProviderId,
  prompt: string,
  aspect: ImageAspect,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const request: PictureHandoffRequest = { provider, prompt, aspect, resolve, reject };
    void eventDispatcher.dispatch(PICTURE_HANDOFF_EVENT, request);
  });

export type OpenResult = 'opened' | 'not-installed';

/** Open Flow / Grok in its app or in the web browser. */
export async function openPictureSite(
  provider: ImageProviderId,
  target: 'app' | 'browser',
): Promise<OpenResult> {
  const site = PICTURE_SITES[provider];
  if (isTauriAppPlatform() && getOSPlatform() === 'android') {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ opened: boolean; installed: boolean }>(
      'plugin:native-bridge|open_url_with',
      {
        payload: {
          url: site.url,
          packageName: target === 'app' ? site.androidPackage : undefined,
          browser: target === 'browser',
        },
      },
    );
    return result.installed ? 'opened' : 'not-installed';
  }
  if (isTauriAppPlatform()) {
    // iOS: the link opens the app when it's installed, else the browser.
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(site.url);
    return 'opened';
  }
  window.open(site.url, '_blank', 'noopener');
  return 'opened';
}

export const storeUrl = (provider: ImageProviderId): string =>
  `https://play.google.com/store/apps/details?id=${PICTURE_SITES[provider].androidPackage}`;

/** Read a picked image file as a data: URL. */
export const readImageFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('That file is not a picture.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the picture.'));
    reader.readAsDataURL(file);
  });
