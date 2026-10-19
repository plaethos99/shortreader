/**
 * Moving the view to the section read-aloud has reached.
 *
 * Read-aloud normally waits for the view to arrive before speaking the new
 * section, so speech and page stay together. That wait cannot be unconditional:
 * a PDF page IS a section, so read-aloud crosses one at every page turn, and
 * with the screen locked the WebView is hidden. pdf.js finishes a page render
 * through requestAnimationFrame, which Chromium never fires while hidden
 * (the TTS keep-alive tone exempts timers from the freeze, not rAF), so
 * `renderer.goTo` never settles and speech stopped dead at each page until the
 * screen came back on. EPUB was unaffected: a whole chapter is one section.
 *
 * While hidden the navigation is therefore started but not waited on — nobody
 * is looking at the page, TTSController falls back to building the section's
 * document itself, and the view catches up when the screen wakes (the mark
 * handler re-navigates whenever the view is behind the spoken section).
 *
 * The visible path keeps waiting, but never forever: how a locked screen
 * reports itself varies by vendor, so a render that cannot finish must not be
 * able to hold speech hostage on a device that still calls itself visible.
 */

// Long enough that a slow-but-real page render still lands before speech, short
// enough that a wedged one costs a beat rather than the rest of the book.
const NAVIGATION_TIMEOUT_MS = 4000;

const isPageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

export const awaitSectionNavigation = async (
  navigation: Promise<unknown> | undefined,
): Promise<void> => {
  if (!navigation) return;

  // A failed page turn is not a reason to stop reading, and nothing else is
  // left to catch it once this returns.
  const settled = Promise.resolve(navigation).then(
    () => undefined,
    (error: unknown) => {
      console.warn('[tts] section navigation failed:', error);
    },
  );

  if (isPageHidden()) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, NAVIGATION_TIMEOUT_MS);
  });
  try {
    await Promise.race([settled, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
