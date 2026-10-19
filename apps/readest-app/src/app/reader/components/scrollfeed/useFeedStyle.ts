'use client';

/**
 * The book's feed style: saved choice, else detected once from the metadata
 * and opening text, else 'story' when detection fails (not saved, so it is
 * tried again next time). The reader can override it.
 */
import { useCallback, useEffect, useState } from 'react';

import type { FeedChapter } from '@/services/scrollfeed/chapters';
import { detectFeedStyle, type FeedStyle } from '@/services/scrollfeed/genre';
import { loadFeedStyle, saveFeedStyle } from '@/services/scrollfeed/store';

interface BookMetadataLike {
  metadata?: { author?: unknown; description?: unknown };
}

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  // foliate metadata fields may be a contributor object or a list of them.
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (value && typeof value === 'object' && 'name' in value) return asText(value.name);
  return '';
};

interface FeedStyleState {
  // null until known; chapters must not be generated before then.
  style: FeedStyle | null;
  setStyle: (style: FeedStyle) => void;
}

export const useFeedStyle = (
  bookHash: string,
  bookDoc: unknown,
  bookTitle: string,
  chapters: FeedChapter[],
): FeedStyleState => {
  const [style, setStyleState] = useState<FeedStyle | null>(null);

  useEffect(() => {
    if (chapters.length === 0) return;
    let cancelled = false;
    void (async () => {
      const saved = await loadFeedStyle(bookHash);
      if (saved) {
        if (!cancelled) setStyleState(saved);
        return;
      }
      const meta = (bookDoc as BookMetadataLike)?.metadata;
      // The detector reads only the opening; a 3M-char book need not be joined.
      const sample = chapters
        .slice(0, 4)
        .map((c) => c.text)
        .join(' ');
      try {
        const detected = await detectFeedStyle(
          {
            title: bookTitle,
            author: asText(meta?.author),
            description: asText(meta?.description),
          },
          sample,
        );
        await saveFeedStyle(bookHash, detected);
        if (!cancelled) setStyleState(detected);
      } catch {
        if (!cancelled) setStyleState('story');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookHash, bookDoc, bookTitle, chapters]);

  const setStyle = useCallback(
    (next: FeedStyle) => {
      setStyleState(next);
      void saveFeedStyle(bookHash, next);
    },
    [bookHash],
  );

  return { style, setStyle };
};
