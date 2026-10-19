'use client';

/**
 * Counts time actually spent reading cards (a chapter open, the app in view)
 * into the daily tally behind the streak. Opening the app earns nothing.
 */
import { useEffect, useRef, useState } from 'react';

import {
  minutesThisWeek,
  readingStreak,
  recordReading,
  type ReadingStats,
} from '@/services/scrollfeed/engagement';
import { loadReadingStats, saveReadingStats } from '@/services/scrollfeed/store';

const TICK_MS = 10000;

export const useReadingStats = (reading: boolean) => {
  const [stats, setStats] = useState<ReadingStats>({ days: {} });
  const statsRef = useRef(stats);

  useEffect(() => {
    void loadReadingStats().then((loaded) => {
      statsRef.current = loaded;
      setStats(loaded);
    });
  }, []);

  useEffect(() => {
    if (!reading) return;
    let last = Date.now();
    const flush = () => {
      const now = Date.now();
      const seconds = document.hidden ? 0 : (now - last) / 1000;
      last = now;
      if (seconds <= 0) return;
      statsRef.current = recordReading(statsRef.current, new Date(), seconds);
      setStats(statsRef.current);
      void saveReadingStats(statsRef.current);
    };
    // Time while hidden is dropped, not counted: restart the clock on return.
    const onVisibility = () => (document.hidden ? flush() : (last = Date.now()));
    const timer = setInterval(flush, TICK_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flush();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reading]);

  const today = new Date();
  return { streak: readingStreak(stats, today), minutes: minutesThisWeek(stats, today) };
};
