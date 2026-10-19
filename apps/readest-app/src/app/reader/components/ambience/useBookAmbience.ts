'use client';

/**
 * A book's colours: its mood's palette, tinted toward its cover.
 *
 * The mood comes from one small model call per book on its title, author and
 * description (or the reader's pick, which detection never overwrites); the
 * cover colours are read on the device.
 * Both are cached, so a book is looked at once.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  blendPalette,
  dominantColors,
  type FeedMood,
  moodPalette,
} from '@/services/scrollfeed/ambience';
import { isTextAIConfigured } from '@/services/byok/aiConfig';
import { detectFeedMood } from '@/services/scrollfeed/genre';
import { type BookAmbience, loadBookAmbience, saveBookAmbience } from '@/services/scrollfeed/store';

interface BookLike {
  metadata?: { title?: unknown; author?: unknown; description?: unknown };
  getCover?: () => Promise<Blob | null>;
}

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (value && typeof value === 'object' && 'name' in value) return asText(value.name);
  return '';
};

const COVER_SAMPLE_PX = 64;

/** The cover's main colours, sampled small: 64 px is plenty for colour. */
async function coverColors(book: BookLike): Promise<string[]> {
  try {
    const blob = await book.getCover?.();
    if (!blob) return [];
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = COVER_SAMPLE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(bitmap, 0, 0, COVER_SAMPLE_PX, COVER_SAMPLE_PX);
    bitmap.close();
    return dominantColors(ctx.getImageData(0, 0, COVER_SAMPLE_PX, COVER_SAMPLE_PX).data, 3);
  } catch {
    return [];
  }
}

export const useBookAmbience = (bookHash: string, bookDoc: unknown, bookTitle: string) => {
  const [ambience, setAmbience] = useState<BookAmbience | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadBookAmbience(bookHash);
      if (saved) {
        if (!cancelled) setAmbience(saved);
        return;
      }
      // Nothing to look at yet, or no model to ask: calm, unsaved, so the
      // book is looked at properly once it can be.
      if (!bookDoc || !isTextAIConfigured()) {
        if (!cancelled) setAmbience({ mood: 'calm', cover: [], chosen: false });
        return;
      }
      const book = bookDoc as BookLike;
      const cover = await coverColors(book);
      let mood: FeedMood = 'calm';
      try {
        mood = await detectFeedMood(
          {
            title: bookTitle,
            author: asText(book.metadata?.author),
            description: asText(book.metadata?.description),
          },
          '',
        );
      } catch {
        // Unsaved below, so detection is tried again next time.
        if (!cancelled) setAmbience({ mood, cover, chosen: false });
        return;
      }
      const detected = { mood, cover, chosen: false };
      await saveBookAmbience(bookHash, detected);
      if (!cancelled) setAmbience(detected);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookHash, bookDoc, bookTitle]);

  const setMood = useCallback(
    (mood: FeedMood) => {
      const next = { mood, cover: ambience?.cover ?? [], chosen: true };
      setAmbience(next);
      void saveBookAmbience(bookHash, next);
    },
    [ambience, bookHash],
  );

  const palette = useMemo(
    () => blendPalette(moodPalette(ambience?.mood ?? 'calm'), ambience?.cover ?? []),
    [ambience],
  );

  return { mood: ambience?.mood ?? null, palette, setMood };
};
