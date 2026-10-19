import { afterEach, describe, expect, test, vi } from 'vitest';

import { awaitSectionNavigation } from '@/services/tts/sectionNavigation';

const setVisibility = (state: DocumentVisibilityState) =>
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);

/** Resolves on the next macrotask, after any pending microtasks have run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe('awaitSectionNavigation', () => {
  test('waits for the view while the screen is on', async () => {
    setVisibility('visible');
    let navigated = false;
    let finishNavigation = () => {};
    const navigation = new Promise<void>((resolve) => {
      finishNavigation = () => {
        navigated = true;
        resolve();
      };
    });

    let done = false;
    void awaitSectionNavigation(navigation).then(() => (done = true));
    await settled();
    expect(done).toBe(false);

    finishNavigation();
    await settled();
    expect(done).toBe(true);
    expect(navigated).toBe(true);
  });

  // A PDF page is a section, so read-aloud crosses one at every page turn.
  // With the screen locked the WebView is hidden and pdf.js never finishes
  // rendering the page (it continues through requestAnimationFrame, which
  // Chromium does not fire while hidden), so awaiting the navigation stopped
  // speech at every page until the screen came back on.
  test('does not wait for a page render that cannot finish while hidden', async () => {
    setVisibility('hidden');
    const neverSettles = new Promise<void>(() => {});

    await expect(awaitSectionNavigation(neverSettles)).resolves.toBeUndefined();
  });

  test('a navigation that fails while hidden does not reject', async () => {
    setVisibility('hidden');

    await expect(
      awaitSectionNavigation(Promise.reject(new Error('gone'))),
    ).resolves.toBeUndefined();
    await settled();
  });

  test('a failed page turn does not stop read-aloud', async () => {
    setVisibility('visible');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      awaitSectionNavigation(Promise.reject(new Error('gone'))),
    ).resolves.toBeUndefined();
  });

  // How a locked screen reports itself varies by vendor. A device that stays
  // "visible" while locked must not be able to wedge speech on a page render
  // that will never finish.
  test('gives up on a render that never finishes, even when visible', async () => {
    vi.useFakeTimers();
    try {
      setVisibility('visible');
      let done = false;
      void awaitSectionNavigation(new Promise<void>(() => {})).then(() => (done = true));

      await vi.advanceTimersByTimeAsync(3000);
      expect(done).toBe(false);

      await vi.advanceTimersByTimeAsync(1500);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('tolerates a renderer with no goTo (undefined navigation)', async () => {
    setVisibility('visible');

    await expect(awaitSectionNavigation(undefined)).resolves.toBeUndefined();
  });
});
