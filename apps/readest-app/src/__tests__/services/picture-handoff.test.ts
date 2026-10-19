import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const platform = vi.hoisted(() => ({ tauri: true, os: 'android' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => platform.tauri,
  isWebAppPlatform: () => false,
}));
vi.mock('@/utils/misc', () => ({ getOSPlatform: () => platform.os }));

import { DEFAULT_AI_CONFIG, useAIConfigStore } from '@/services/byok/aiConfig';
import { generateImage, isImageGenConfigured } from '@/services/imageBridge';
import {
  PICTURE_HANDOFF_EVENT,
  openPictureSite,
  readImageFile,
  type PictureHandoffRequest,
} from '@/services/pictureHandoff';
import { eventDispatcher } from '@/utils/event';

describe('pictures on a phone (hand-off to the Flow / Grok app)', () => {
  beforeEach(() => {
    invoke.mockReset();
    platform.tauri = true;
    platform.os = 'android';
    useAIConfigStore.setState({ config: { ...DEFAULT_AI_CONFIG } });
  });
  afterEach(() => vi.unstubAllGlobals());

  test('is the default on a phone, and needs no bridge address', () => {
    useAIConfigStore.setState({ config: { ...DEFAULT_AI_CONFIG, bridgeUrl: '' } });
    expect(isImageGenConfigured()).toBe(true);
  });

  test('asks the reader for the picture instead of calling a bridge', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const seen: PictureHandoffRequest[] = [];
    const onShow = (e: CustomEvent) => {
      const request = e.detail as PictureHandoffRequest;
      seen.push(request);
      request.resolve('data:image/png;base64,AAAA');
    };
    eventDispatcher.on(PICTURE_HANDOFF_EVENT, onShow);

    const url = await generateImage('a white rabbit with a pocket watch', '4:3');

    eventDispatcher.off(PICTURE_HANDOFF_EVENT, onShow);
    expect(url).toBe('data:image/png;base64,AAAA');
    expect(seen[0]).toMatchObject({
      provider: 'flow',
      prompt: 'a white rabbit with a pocket watch',
      aspect: '4:3',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('opens the Flow app by package name, or the browser', async () => {
    invoke.mockResolvedValue({ opened: true, installed: true });

    expect(await openPictureSite('flow', 'app')).toBe('opened');
    expect(invoke).toHaveBeenLastCalledWith('plugin:native-bridge|open_url_with', {
      payload: {
        url: 'https://flow.google.com/',
        packageName: 'com.google.android.apps.labs.whisk',
        browser: false,
      },
    });

    await openPictureSite('imagine', 'browser');
    expect(invoke).toHaveBeenLastCalledWith('plugin:native-bridge|open_url_with', {
      payload: { url: 'https://grok.com/imagine', packageName: undefined, browser: true },
    });
  });

  test('says when the app is not installed', async () => {
    invoke.mockResolvedValue({ opened: false, installed: false });
    expect(await openPictureSite('imagine', 'app')).toBe('not-installed');
  });

  test('takes back only pictures', async () => {
    await expect(
      readImageFile(new File(['x'], 'notes.txt', { type: 'text/plain' })),
    ).rejects.toThrow(/not a picture/);
    expect(
      await readImageFile(new File([new Uint8Array([1, 2])], 'p.png', { type: 'image/png' })),
    ).toMatch(/^data:image\/png;base64,/);
  });
});
