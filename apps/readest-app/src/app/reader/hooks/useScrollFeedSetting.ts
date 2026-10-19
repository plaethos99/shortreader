import { useCallback } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { saveViewSettings } from '@/helpers/settings';
import { setReadingMode } from '@/services/readingMode';
import { useBookDataStore } from '@/store/bookDataStore';

/**
 * The per-book curated-feed switch, shared by every control that flips it.
 *
 * Two places need it — the header toggler and the feed's own exit button — and
 * a second copy of the save/mirror dance is a second chance for them to
 * disagree about whether the feed is on.
 */
export const useScrollFeedSetting = (bookKey: string) => {
  const { envConfig, appService } = useEnv();
  const { getViewSettings, setViewSettings, setHoveredBookKey } = useReaderStore();
  // Not asserted non-null: turning the feed OFF unmounts the view that called
  // this hook, and it renders once more on the way out — by which point the
  // book's settings can already be gone. Asserting here crashed ScrollFeedView
  // into the error boundary on every exit.
  const enabled = getViewSettings(bookKey)?.scrollFeed ?? false;

  const setEnabled = useCallback(
    (next: boolean) => {
      // Read fresh rather than closing over the settings: the callback outlives
      // the render that made it.
      const viewSettings = getViewSettings(bookKey);
      if (!viewSettings || next === viewSettings.scrollFeed) return;
      if (appService?.isMobile) {
        setHoveredBookKey('');
      }
      // Per book, and without a restyle: the feed is its own overlay, not a
      // change to how the book itself is laid out.
      saveViewSettings(envConfig, bookKey, 'scrollFeed', next, true, false);
      // Remembered per book: the book opens this way next time.
      const hash = useBookDataStore.getState().getBookData(bookKey)?.book?.hash;
      if (hash) setReadingMode(hash, next ? 'curated' : 'original');
      viewSettings.scrollFeed = next;
      setViewSettings(bookKey, { ...viewSettings });
    },
    [envConfig, bookKey, getViewSettings, setViewSettings, appService, setHoveredBookKey],
  );

  return { enabled, setEnabled };
};
