import { beforeEach, describe, expect, test, vi } from 'vitest';

type Payload = Record<string, unknown>;
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import { makeImageInWindow } from '@/services/imagegen/androidWindow';

/** A fake native window: page addresses step by step, scripts answered by a
 * function of their text. */
const fakeWindow = (urls: string[], answer: (expression: string) => unknown) => {
  let step = 0;
  const calls: Payload[] = [];
  invoke.mockImplementation(async (_cmd: string, { payload }: { payload: Payload }) => {
    calls.push(payload);
    switch (payload['action']) {
      case 'state':
        return { url: urls[Math.min(step++, urls.length - 1)], open: true };
      case 'eval': {
        const value = answer(String(payload['expression']));
        return { json: JSON.stringify({ ok: true, value: value ?? null }) };
      }
      case 'type':
        return { typed: true };
      default:
        return {};
    }
  });
  return calls;
};

vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });

describe('pictures in the in-app window (Android)', () => {
  beforeEach(() => {
    invoke.mockReset();
    fetchMock.mockReset();
  });

  test('Grok: waits for sign-in, types the prompt with real taps, returns the picture', async () => {
    let signedIn = false;
    const calls = fakeWindow(['https://grok.com/imagine', 'https://grok.com/imagine'], (e) => {
      if (e.includes('sign (in|up)')) {
        const was = signedIn;
        signedIn = true;
        return was;
      }
      if (e === 'window.innerWidth') return 400;
      if (e.startsWith('window.__srGrok.prepare(')) return { x: 100, y: 600 };
      if (e.includes("execCommand('insertText'")) return true;
      if (e === 'window.__srGrok.submitAt()') return { x: 360, y: 640 };
      if (e === 'window.__srGrok.waitForImage()') return 'JPEGDATA';
      return 'ready';
    });

    const image = await makeImageInWindow('imagine', 'a white rabbit', '16:9');

    expect(image).toEqual({ mimeType: 'image/jpeg', data: 'JPEGDATA' });
    expect(calls[0]).toMatchObject({ action: 'open', url: 'https://grok.com/imagine' });
    const taps = calls.filter((c) => c['action'] === 'tap');
    expect(taps).toEqual([
      { action: 'tap', x: 100, y: 600, viewportWidth: 400 },
      { action: 'tap', x: 360, y: 640, viewportWidth: 400 },
    ]);
    expect(calls.some((c) => String(c['expression']).includes('a white rabbit'))).toBe(true);
    expect(calls.at(-1)).toEqual({ action: 'hide' });
  });

  test('Flow: opens a project by itself, then makes and downloads the picture', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const calls = fakeWindow(
      ['https://flow.google.com/', 'https://flow.google.com/project/abc'],
      (e) => {
        if (e.includes('__shortreader.startProject()')) return { x: 200, y: 300 };
        if (e === 'window.innerWidth') return 400;
        if (e.startsWith('window.__shortreader.prepare(')) return { x: 380, y: 700 };
        if (e === 'window.__shortreader.waitForImage()')
          return 'https://flow-content.google/image/x';
        return 'ready';
      },
    );

    const image = await makeImageInWindow('flow', 'a lighthouse', '4:3');

    expect(image).toEqual({ mimeType: 'image/jpeg', data: 'AQID' });
    expect(fetchMock).toHaveBeenCalledWith('https://flow-content.google/image/x');
    const taps = calls.filter((c) => c['action'] === 'tap').map((c) => [c['x'], c['y']]);
    expect(taps).toEqual([
      [200, 300],
      [380, 700],
    ]);
    expect(calls.some((c) => String(c['expression']).includes('"aspect":"4:3"'))).toBe(true);
  });

  test('stops when the reader closes the window', async () => {
    invoke.mockImplementation(async (_cmd: string, { payload }: { payload: Payload }) =>
      payload['action'] === 'state' ? { url: 'https://accounts.google.com/', open: false } : {},
    );
    await expect(makeImageInWindow('flow', 'x')).rejects.toThrow(/window was closed/);
  });

  test('page scripts are sent as expressions (no trailing semicolon)', async () => {
    const calls = fakeWindow(['https://grok.com/imagine'], (e) => {
      if (e.includes('sign (in|up)')) return true;
      if (e === 'window.innerWidth') return 400;
      if (e.startsWith('window.__srGrok.prepare(') || e === 'window.__srGrok.submitAt()') {
        return { x: 1, y: 1 };
      }
      if (e.includes("execCommand('insertText'")) return true;
      if (e === 'window.__srGrok.waitForImage()') return 'J';
      return null;
    });
    await makeImageInWindow('imagine', 'x');
    const evals = calls.filter((c) => c['action'] === 'eval').map((c) => String(c['expression']));
    expect(evals.every((e) => !e.trim().endsWith(';'))).toBe(true);
  });
});
