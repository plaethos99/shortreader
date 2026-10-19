'use client';

/**
 * The reader's look settings (text motion, background, sound, haptics), shared
 * by the feed and focus mode. E-ink gets the still version whatever was
 * chosen: moving backgrounds and reveals only smear on a slow-refresh screen.
 */
import { useCallback, useEffect, useState } from 'react';

import { eventDispatcher } from '@/utils/event';
import {
  DEFAULT_LOOK,
  type FeedLook,
  loadFeedLook,
  saveFeedLook,
} from '@/services/scrollfeed/store';
import { isEinkMode } from './AmbientBackground';

const LOOK_EVENT = 'feed-look-changed';

export const useFeedLook = () => {
  const [look, setLookState] = useState<FeedLook>(DEFAULT_LOOK);

  useEffect(() => {
    let cancelled = false;
    void loadFeedLook().then((saved) => !cancelled && setLookState(saved));
    // The feed's look panel and focus mode can both be mounted: keep them in
    // step without a store.
    const onChange = (event: CustomEvent) => setLookState(event.detail as FeedLook);
    eventDispatcher.on(LOOK_EVENT, onChange);
    return () => {
      cancelled = true;
      eventDispatcher.off(LOOK_EVENT, onChange);
    };
  }, []);

  const setLook = useCallback((next: FeedLook) => {
    setLookState(next);
    void saveFeedLook(next);
    eventDispatcher.dispatch(LOOK_EVENT, next);
  }, []);

  const effective: FeedLook = isEinkMode() ? { ...look, motion: 'rise', backdrop: 'plain' } : look;
  return { look, effective, setLook };
};
