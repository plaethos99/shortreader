import { describe, expect, test, vi } from 'vitest';

import { makeImage, siteState, type Platform, type Tab } from '@/services/imagegen/core';

const tab = (url: string): Tab => ({ type: 'page', url, webSocketDebuggerUrl: `ws://x/${url}` });

/** A fake browser whose tabs change as the "user" signs in, step by step. */
const fakeBrowser = (steps: (Tab[] | null)[], evaluate: (expr: string, t: Tab) => unknown) => {
  let step = 0;
  const sent: { tab: string; method: string; params?: Record<string, unknown> }[] = [];
  const platform: Platform = {
    launch: vi.fn(async () => {}),
    openTab: vi.fn(async () => {}),
    tabs: vi.fn(async () => steps[Math.min(step++, steps.length - 1)] ?? null),
    connect: async (t) => ({
      send: async (method, params) => {
        sent.push({ tab: t.url, method, params });
        if (method === 'Runtime.evaluate') {
          return { result: { value: evaluate(String(params?.['expression']), t) } };
        }
        return {};
      },
      close: () => {},
    }),
    download: vi.fn(async (url: string) => ({ mimeType: 'image/png', data: `bytes-of:${url}` })),
    sleep: async () => {},
  };
  return { platform, sent };
};

describe('image engine', () => {
  test('opens Flow, waits for sign-in, opens a project, then makes the picture', async () => {
    const home = tab('https://flow.google.com/');
    const project = tab('https://flow.google.com/project/abc');
    const { platform, sent } = fakeBrowser(
      [
        null, // not running yet
        [tab('https://accounts.google.com/signin')], // signing in
        [home], // signed in, on Flow's home page
        [project], // the project it opened
      ],
      (expr) => {
        if (expr.startsWith('window.__shortreader.startProject')) return true;
        if (expr.startsWith('window.__shortreader.prepare(')) return { x: 10, y: 20 };
        if (expr.startsWith('window.__shortreader.waitForImage'))
          return 'https://flow-content.google/image/new';
        return 'ready';
      },
    );
    const progress: string[] = [];

    const image = await makeImage(platform, 'flow', 'a lighthouse', '4:3', (s) => progress.push(s));

    expect(platform.launch).toHaveBeenCalledWith('flow', 'https://flow.google.com/', 9434);
    expect(progress).toEqual([
      'Opening Google Flow…',
      'Sign in to Google Flow in the browser window that opened. The picture starts by itself once you are in.',
      'Opening a Flow project…',
      'Making the picture in Google Flow…',
    ]);
    // The sign-in page was left alone: no extra Flow tabs while signing in.
    expect(platform.openTab).not.toHaveBeenCalled();
    const prepare = sent.find((s) =>
      String(s.params?.['expression']).startsWith('window.__shortreader.prepare('),
    );
    expect(prepare?.tab).toBe(project.url);
    expect(String(prepare?.params?.['expression'])).toContain('"aspect":"4:3"');
    expect(sent.filter((s) => s.method === 'Input.dispatchMouseEvent')).toHaveLength(3);
    expect(image).toEqual({
      mimeType: 'image/png',
      data: 'bytes-of:https://flow-content.google/image/new',
    });
  });

  test('Grok Imagine waits until the page shows the reader is signed in', async () => {
    const imagine = tab('https://grok.com/imagine');
    let signedIn = false;
    const { platform, sent } = fakeBrowser([[imagine]], (expr) => {
      if (expr.includes('sign (in|up)')) {
        const was = signedIn;
        signedIn = true; // signs in between the first and second look
        return was;
      }
      if (expr.includes('prepare(')) return { x: 1, y: 2 };
      if (expr.includes('submitAt()')) return { x: 3, y: 4 };
      if (expr.includes('waitForImage()')) return 'JPEGDATA';
      return undefined;
    });

    const image = await makeImage(platform, 'imagine', 'a fox', '16:9');

    expect(image).toEqual({ mimeType: 'image/jpeg', data: 'JPEGDATA' });
    expect(sent.find((s) => s.method === 'Input.insertText')?.params).toEqual({ text: 'a fox' });
    expect(platform.launch).not.toHaveBeenCalled();
  });

  test('reports each site as closed, signing in or ready', async () => {
    const { platform } = fakeBrowser(
      [null, [tab('https://accounts.google.com/x')], [tab('https://flow.google.com/project/1')]],
      () => true,
    );
    expect(await siteState(platform, 'flow')).toBe('closed');
    expect(await siteState(platform, 'flow')).toBe('signin');
    expect(await siteState(platform, 'flow')).toBe('ready');
  });

  test('refuses a bad aspect or an empty prompt before opening anything', async () => {
    const { platform } = fakeBrowser([null], () => null);
    await expect(makeImage(platform, 'flow', 'x', '2:1' as '1:1')).rejects.toThrow(/Aspect/);
    await expect(makeImage(platform, 'flow', '  ')).rejects.toThrow(/prompt/);
    expect(platform.launch).not.toHaveBeenCalled();
  });
});
