/**
 * Scroll-feed persistence (IndexedDB).
 *
 * Deliberately NOT localStorage: AiPanel already has to delete artifacts on
 * quota errors because base64 images blow the ~5MB budget, and a per-book feed
 * with illustrations is far larger than that. IndexedDB stores blobs natively,
 * has a quota in the hundreds of MB, and works the same on web, the Android
 * WebView and desktop — no Rust plugin round trip.
 */
import {
  type Backdrop,
  BACKDROPS,
  type FeedMood,
  type TextMotion,
  TEXT_MOTIONS,
  toMood,
} from './ambience';
import type { AudioScript } from './audiostory';
import type { ReadingStats } from './engagement';
import { FEED_STYLES, type FeedStyle } from './genre';
import type { FeedProgress } from './playback';
import { ChapterFeed } from './types';

const DB_NAME = 'readster-scrollfeed';
// v2 added the progress and prefs stores, v3 the OCR store, v4 highlights,
// v5 audio story scripts. openDb creates any store that is missing, so an
// older database upgrades in place without losing feeds.
const DB_VERSION = 5;
const FEEDS = 'feeds';
const IMAGES = 'images';
const PROGRESS = 'progress';
const PREFS = 'prefs';
const OCR = 'ocr';
const HIGHLIGHTS = 'highlights';
const AUDIO = 'audio';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FEEDS)) db.createObjectStore(FEEDS);
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
      if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS);
      if (!db.objectStoreNames.contains(PREFS)) db.createObjectStore(PREFS);
      if (!db.objectStoreNames.contains(OCR)) db.createObjectStore(OCR);
      if (!db.objectStoreNames.contains(HIGHLIGHTS)) db.createObjectStore(HIGHLIGHTS);
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const run = async <T>(
  store: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// Feeds are stored per CHAPTER, not per book: chapters are generated on demand
// as the reader scrolls, so a book abandoned after three chapters keeps those
// three rather than nothing.
const feedKey = (bookHash: string, chapterIdx: number) => `${bookHash}:${chapterIdx}`;

export const loadChapterFeed = async (
  bookHash: string,
  chapterIdx: number,
): Promise<ChapterFeed | null> => {
  try {
    return (
      (await run<ChapterFeed | undefined>(FEEDS, 'readonly', (s) =>
        s.get(feedKey(bookHash, chapterIdx)),
      )) ?? null
    );
  } catch {
    return null;
  }
};

export const saveChapterFeed = async (bookHash: string, feed: ChapterFeed): Promise<void> => {
  await run(FEEDS, 'readwrite', (s) => s.put(feed, feedKey(bookHash, feed.chapterIdx)));
};

// Images are keyed by card id, scoped by book so two books can't collide.
const imageKey = (bookHash: string, cardId: string) => `${bookHash}:${cardId}`;

export const loadCardImage = async (bookHash: string, cardId: string): Promise<Blob | null> => {
  try {
    return (
      (await run<Blob | undefined>(IMAGES, 'readonly', (s) => s.get(imageKey(bookHash, cardId)))) ??
      null
    );
  } catch {
    return null;
  }
};

export const saveCardImage = async (
  bookHash: string,
  cardId: string,
  image: Blob,
): Promise<void> => {
  await run(IMAGES, 'readwrite', (s) => s.put(image, imageKey(bookHash, cardId)));
};

// Text read off a scanned page, per book and section: a page costs one OCR
// call ever, however often its chapter is regenerated.
const ocrKey = (bookHash: string, section: number) => `${bookHash}:${section}`;

export const loadOcrText = async (bookHash: string, section: number): Promise<string | null> => {
  try {
    const text = await run<unknown>(OCR, 'readonly', (s) => s.get(ocrKey(bookHash, section)));
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
};

export const saveOcrText = async (bookHash: string, section: number, text: string) => {
  try {
    await run(OCR, 'readwrite', (s) => s.put(text, ocrKey(bookHash, section)));
  } catch {
    // Unsaved, the page is read again next time: a call, not a failure.
  }
};

// An audio story chapter's script, per book and chapter, like the feeds.
export const loadAudioScript = async (
  bookHash: string,
  chapterIdx: number,
): Promise<AudioScript | null> => {
  try {
    return (
      (await run<AudioScript | undefined>(AUDIO, 'readonly', (s) =>
        s.get(feedKey(bookHash, chapterIdx)),
      )) ?? null
    );
  } catch {
    return null;
  }
};

export const saveAudioScript = async (bookHash: string, script: AudioScript): Promise<void> => {
  try {
    await run(AUDIO, 'readwrite', (s) => s.put(script, feedKey(bookHash, script.chapterIdx)));
  } catch {
    // Unsaved, the chapter is scripted again next time: a call, not a failure.
  }
};

// Where listening stopped, per book: the chapter and the paragraph in it.
export interface AudioProgress {
  chapterIdx: number;
  paragraph: number;
}

const audioProgressKey = (bookHash: string) => `audio-progress:${bookHash}`;

export const loadAudioProgress = async (bookHash: string): Promise<AudioProgress | null> => {
  try {
    return (
      (await run<AudioProgress | undefined>(PREFS, 'readonly', (s) =>
        s.get(audioProgressKey(bookHash)),
      )) ?? null
    );
  } catch {
    return null;
  }
};

export const saveAudioProgress = async (bookHash: string, progress: AudioProgress) => {
  try {
    await run(PREFS, 'readwrite', (s) => s.put(progress, audioProgressKey(bookHash)));
  } catch {
    // Same as the feed's resume point: not worth interrupting listening over.
  }
};

// Where the reader stopped, per book, so reopening lands on the card they left
// rather than the chapter list.
export const loadFeedProgress = async (bookHash: string): Promise<FeedProgress | null> => {
  try {
    return (
      (await run<FeedProgress | undefined>(PROGRESS, 'readonly', (s) => s.get(bookHash))) ?? null
    );
  } catch {
    return null;
  }
};

export const saveFeedProgress = async (bookHash: string, progress: FeedProgress): Promise<void> => {
  try {
    await run(PROGRESS, 'readwrite', (s) => s.put(progress, bookHash));
  } catch {
    // Losing a resume point is not worth interrupting reading over.
  }
};

// The book's feed style, detected once (a model call) or picked by the reader.
const styleKey = (bookHash: string) => `style:${bookHash}`;

export const loadFeedStyle = async (bookHash: string): Promise<FeedStyle | null> => {
  try {
    const style = await run<unknown>(PREFS, 'readonly', (s) => s.get(styleKey(bookHash)));
    return FEED_STYLES.includes(style as FeedStyle) ? (style as FeedStyle) : null;
  } catch {
    return null;
  }
};

export const saveFeedStyle = async (bookHash: string, style: FeedStyle): Promise<void> => {
  try {
    await run(PREFS, 'readwrite', (s) => s.put(style, styleKey(bookHash)));
  } catch {
    // Unsaved, the style is detected again next time: a call, not a failure.
  }
};

// The language the feed is written in, per book: a reader may want a Tamil
// epic retold in Telugu but an English one left in English.
const languageKey = (bookHash: string) => `language:${bookHash}`;

export const loadFeedLanguage = async (bookHash: string): Promise<string | null> => {
  try {
    const code = await run<unknown>(PREFS, 'readonly', (s) => s.get(languageKey(bookHash)));
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
};

export const saveFeedLanguage = async (bookHash: string, code: string): Promise<void> => {
  try {
    await run(PREFS, 'readwrite', (s) => s.put(code, languageKey(bookHash)));
  } catch {
    // Same as the style: a lost choice costs a re-pick, not a failure.
  }
};

// Voice and speed are global, not per book: a reader picks a narrator once.
export interface FeedPrefs {
  voiceId: string;
  rate: number;
}

const PREFS_KEY = 'read-along';

export const loadFeedPrefs = async (): Promise<FeedPrefs | null> => {
  try {
    return (await run<FeedPrefs | undefined>(PREFS, 'readonly', (s) => s.get(PREFS_KEY))) ?? null;
  } catch {
    return null;
  }
};

export const saveFeedPrefs = async (prefs: FeedPrefs): Promise<void> => {
  try {
    await run(PREFS, 'readwrite', (s) => s.put(prefs, PREFS_KEY));
  } catch {
    // Same: a lost preference is a nuisance, not a failure worth surfacing.
  }
};

// How the feed and focus mode look and feel. Global, like the narrator.
export interface FeedLook {
  motion: TextMotion;
  backdrop: Backdrop;
  sound: boolean;
  haptics: boolean;
}

export const DEFAULT_LOOK: FeedLook = {
  motion: 'spot',
  backdrop: 'aurora',
  sound: true,
  haptics: true,
};

const LOOK_KEY = 'look';

export const loadFeedLook = async (): Promise<FeedLook> => {
  try {
    const saved = await run<Partial<FeedLook> | undefined>(PREFS, 'readonly', (s) =>
      s.get(LOOK_KEY),
    );
    // Saved values are checked, not trusted: an option may have been removed.
    return {
      motion: TEXT_MOTIONS.some((m) => m.id === saved?.motion)
        ? saved!.motion!
        : DEFAULT_LOOK.motion,
      backdrop: BACKDROPS.some((b) => b.id === saved?.backdrop)
        ? saved!.backdrop!
        : DEFAULT_LOOK.backdrop,
      sound: typeof saved?.sound === 'boolean' ? saved.sound : DEFAULT_LOOK.sound,
      haptics: typeof saved?.haptics === 'boolean' ? saved.haptics : DEFAULT_LOOK.haptics,
    };
  } catch {
    return DEFAULT_LOOK;
  }
};

export const saveFeedLook = async (look: FeedLook): Promise<void> => {
  try {
    await run(PREFS, 'readwrite', (s) => s.put(look, LOOK_KEY));
  } catch {
    // A lost look reverts to the default: a nuisance, not a failure.
  }
};

// A book's colours: its mood (detected, or the reader's pick) and the main
// colours of its cover.
export interface BookAmbience {
  mood: FeedMood;
  cover: string[];
  // True when the reader picked the mood; never overwritten by detection.
  chosen: boolean;
}

const ambienceKey = (bookHash: string) => `ambience:${bookHash}`;

export const loadBookAmbience = async (bookHash: string): Promise<BookAmbience | null> => {
  try {
    const saved = await run<Partial<BookAmbience> | undefined>(PREFS, 'readonly', (s) =>
      s.get(ambienceKey(bookHash)),
    );
    if (!saved) return null;
    return {
      mood: toMood(saved.mood),
      cover: Array.isArray(saved.cover) ? saved.cover.filter((c) => typeof c === 'string') : [],
      chosen: saved.chosen === true,
    };
  } catch {
    return null;
  }
};

export const saveBookAmbience = async (bookHash: string, ambience: BookAmbience) => {
  try {
    await run(PREFS, 'readwrite', (s) => s.put(ambience, ambienceKey(bookHash)));
  } catch {
    // Unsaved, the mood is detected again next time: a call, not a failure.
  }
};

const STATS_KEY = 'reading-stats';

export const loadReadingStats = async (): Promise<ReadingStats> => {
  try {
    const saved = await run<ReadingStats | undefined>(PREFS, 'readonly', (s) => s.get(STATS_KEY));
    return saved && typeof saved.days === 'object' ? saved : { days: {} };
  } catch {
    return { days: {} };
  }
};

export const saveReadingStats = async (stats: ReadingStats): Promise<void> => {
  try {
    await run(PREFS, 'readwrite', (s) => s.put(stats, STATS_KEY));
  } catch {
    // Losing a few seconds of the tally is not worth interrupting reading.
  }
};

// A line the reader kept: long-press on a card. Kept per card, so saving the
// same card twice keeps one.
export interface FeedHighlight {
  bookHash: string;
  bookTitle: string;
  chapterTitle: string;
  cardId: string;
  text: string;
  savedAt: number;
}

const highlightKey = (bookHash: string, cardId: string) => `${bookHash}:${cardId}`;

export const saveHighlight = async (highlight: FeedHighlight): Promise<void> => {
  await run(HIGHLIGHTS, 'readwrite', (s) =>
    s.put(highlight, highlightKey(highlight.bookHash, highlight.cardId)),
  );
};

export const deleteHighlight = async (bookHash: string, cardId: string): Promise<void> => {
  await run(HIGHLIGHTS, 'readwrite', (s) => s.delete(highlightKey(bookHash, cardId)));
};

/** Every saved highlight, newest first. */
export const loadHighlights = async (): Promise<FeedHighlight[]> => {
  try {
    const all = await run<FeedHighlight[]>(HIGHLIGHTS, 'readonly', (s) => s.getAll());
    return [...all].sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
};
