/**
 * Decisions behind feed playback: when to condense ahead, which voices to
 * offer, what speeds are legal, and where to resume.
 *
 * Pure functions, separate from the IndexedDB and Edge TTS plumbing that uses
 * them, so the rules are testable without a browser.
 */
import type { FeedChapter } from './chapters';
import { mathToSpeech } from '@/utils/mathText';
import type { FeedCard } from './types';

export interface FeedVoice {
  name: string;
  id: string;
  lang: string;
}

export interface FeedProgress {
  chapterIdx: number;
  cardIdx: number;
}

// Speeds offered in the feed. Edge accepts a wider range; these are the ones
// that stay intelligible for prose.
export const FEED_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

// How close to the end of a chapter the reader must be before the next chapter
// starts condensing in the background. Small enough not to spend a call on a
// chapter most readers abandon before reaching, large enough that a ~10s Gemini
// round trip finishes before they arrive.
const PREFETCH_WITHIN = 3;

export const shouldPrefetchNext = (activeCard: number, total: number): boolean =>
  total > 0 && activeCard >= total - PREFETCH_WITHIN && activeCard > 0;

/** Voices for the book's language, falling back to English so a book in a
 * language Edge has no voice for is still readable aloud. */
export const voicesForLang = (voices: FeedVoice[], lang: string): FeedVoice[] => {
  const prefix = (lang || 'en').split('-')[0]!.toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  if (matching.length) return matching;
  return voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
};

// Matches EdgeSpeaker's own default, so the feed and the AI panel's Listen
// buttons sound like the same app.
const PREFERRED_VOICE_ID = 'en-US-AriaNeural';

/** The narrator to start with when the reader hasn't chosen one. Edge groups
 * voices by locale, so the plain first entry for English is en-AU — picked by
 * alphabetical order of locale codes rather than by being a good default. */
export const defaultVoiceId = (voices: FeedVoice[]): string => {
  const preferred = voices.find((v) => v.id === PREFERRED_VOICE_ID);
  return preferred?.id ?? voices[0]?.id ?? '';
};

/** Snap a speed to the nearest supported one. A value restored from storage may
 * predate a change to FEED_SPEEDS, and Edge rejects out-of-range rates. */
export const clampRate = (rate: number | undefined): number => {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
  return FEED_SPEEDS.reduce((best, speed) =>
    Math.abs(speed - rate) < Math.abs(best - rate) ? speed : best,
  );
};

/** What read-along says for a card: the title, the paragraph, the points and
 * the author's line. Never the code example — read aloud it is noise — and
 * equations as words ("v equals d over t"), not their LaTeX. */
export const spokenText = (card: FeedCard): string =>
  [card.title, card.story, ...card.points, card.quote]
    .filter(Boolean)
    .map(mathToSpeech)
    .map((part) => (card.title && !/[.!?…]$/.test(part) ? `${part}.` : part))
    .join(' ');

/** Where to reopen the feed, or null to show the chapter list instead. Progress
 * pointing past the end of the book is discarded: a re-imported or edited book
 * can extract to fewer chapters than were there when it was stored. */
export const resumePoint = (
  chapters: FeedChapter[],
  progress: FeedProgress | null,
): FeedProgress | null => {
  if (!progress) return null;
  if (progress.chapterIdx < 0 || progress.chapterIdx >= chapters.length) return null;
  return progress;
};
