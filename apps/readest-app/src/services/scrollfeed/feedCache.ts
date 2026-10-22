/**
 * Chapter feeds from the cache when they're still good, and making the ones
 * that aren't — for the feed (one chapter as it opens) and for "Read all"
 * (every chapter, ahead of reading the whole book aloud).
 */
import { isSparse, withCardDefaults } from './cards';
import type { FeedChapter } from './chapters';
import { generateChapterFeed } from './generate';
import type { FeedStyle } from './genre';
import { loadChapterFeed, saveChapterFeed } from './store';
import { FEED_FORMAT, type ChapterFeed } from './types';

// A sparse feed (a truncated reply, or a PDF chapter cached before line
// spacing was fixed), one in an older card format, or one made in another
// style is regenerated rather than served from cache forever.
export const loadUsableFeed = async (
  bookHash: string,
  chapter: FeedChapter,
  style: FeedStyle,
  language: string,
): Promise<ChapterFeed | null> => {
  const cached = await loadChapterFeed(bookHash, chapter.idx);
  if (!cached || cached.format !== FEED_FORMAT) return null;
  // Feeds are stored by chapter index. When the chapter list is worked out
  // differently (junk pages dropped, headings found), an index can name
  // another chapter; its title tells.
  if (cached.title !== chapter.title) return null;
  if ((cached.style ?? 'story') !== style) return null;
  if ((cached.language ?? 'en') !== language) return null;
  return isSparse(cached.cards.length, chapter.text) ? null : withCardDefaults(cached);
};

export const saveUsableFeed = async (bookHash: string, chapter: FeedChapter, feed: ChapterFeed) => {
  if (!isSparse(feed.cards.length, chapter.text)) await saveChapterFeed(bookHash, feed);
};

export interface AllFeedsOptions {
  bookHash: string;
  bookTitle: string;
  chapters: FeedChapter[];
  style: FeedStyle;
  language: string;
  // Text for a scanned chapter (read off its page images), as the feed does.
  withText: (chapter: FeedChapter) => Promise<FeedChapter>;
  // Each chapter as it's ready, cached or made: (done so far, of total).
  onProgress?: (done: number, total: number, feed: ChapterFeed) => void;
  signal?: AbortSignal;
  // Chapters made at once.
  concurrency?: number;
}

/** Every chapter's feed, in reading order: cached ones as they are, the rest
 * made now (and cached). Chapters with nothing to retell are left out. */
export async function loadAllChapterFeeds({
  bookHash,
  bookTitle,
  chapters,
  style,
  language,
  withText,
  onProgress,
  signal,
  concurrency = 2,
}: AllFeedsOptions): Promise<ChapterFeed[]> {
  const feeds: (ChapterFeed | null)[] = new Array(chapters.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < chapters.length) {
      if (signal?.aborted) throw new Error('Cancelled');
      const i = next++;
      const chapter = await withText(chapters[i]!);
      let feed = await loadUsableFeed(bookHash, chapter, style, language);
      if (!feed) {
        feed = await generateChapterFeed(
          chapter.idx,
          chapter.title,
          chapter.text,
          bookTitle,
          style,
          language,
        );
        await saveUsableFeed(bookHash, chapter, feed);
      }
      feeds[i] = feed;
      onProgress?.(++done, chapters.length, feed);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chapters.length) }, worker));
  return feeds.filter((f): f is ChapterFeed => !!f && f.cards.length > 0);
}
