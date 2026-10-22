import { beforeEach, describe, expect, test, vi } from 'vitest';

const store = vi.hoisted(() => ({
  saved: new Map<number, unknown>(),
}));
const generateChapterFeed = vi.hoisted(() => vi.fn());
vi.mock('@/services/scrollfeed/store', () => ({
  loadChapterFeed: async (_hash: string, idx: number) => store.saved.get(idx) ?? null,
  saveChapterFeed: async (_hash: string, feed: { chapterIdx: number }) => {
    store.saved.set(feed.chapterIdx, feed);
  },
}));
vi.mock('@/services/scrollfeed/generate', () => ({ generateChapterFeed }));

import { loadAllChapterFeeds } from '@/services/scrollfeed/feedCache';
import { FEED_FORMAT } from '@/services/scrollfeed/types';

const text = 'A sentence of the chapter. '.repeat(400);
const chapter = (idx: number) => ({ idx, title: `Chapter ${idx}`, text });
const feedFor = (idx: number, cards = 8) => ({
  format: FEED_FORMAT,
  style: 'story',
  language: 'en',
  chapterIdx: idx,
  title: `Chapter ${idx}`,
  cards: Array.from({ length: cards }, (_, i) => ({ id: `${idx}-${i}`, story: `Card ${i}.` })),
});

describe('curating every chapter for Read all', () => {
  beforeEach(() => {
    store.saved.clear();
    generateChapterFeed.mockReset();
  });

  test('uses cached chapters, makes and saves the rest, in reading order', async () => {
    store.saved.set(1, feedFor(1));
    generateChapterFeed.mockImplementation(async (idx: number) => feedFor(idx));
    const progress: number[] = [];

    const feeds = await loadAllChapterFeeds({
      bookHash: 'b',
      bookTitle: 'Book',
      chapters: [chapter(0), chapter(1), chapter(2)],
      style: 'story',
      language: 'en',
      withText: async (c) => c,
      onProgress: (done) => progress.push(done),
    });

    expect(feeds.map((f) => f.chapterIdx)).toEqual([0, 1, 2]);
    expect(generateChapterFeed.mock.calls.map((c) => c[0]).sort()).toEqual([0, 2]);
    expect([...store.saved.keys()].sort()).toEqual([0, 1, 2]);
    expect(progress.sort()).toEqual([1, 2, 3]);
  });

  test('leaves out chapters with nothing to read', async () => {
    generateChapterFeed.mockImplementation(async (idx: number) => feedFor(idx, idx === 1 ? 0 : 8));
    const feeds = await loadAllChapterFeeds({
      bookHash: 'b',
      bookTitle: 'Book',
      chapters: [chapter(0), chapter(1)],
      style: 'story',
      language: 'en',
      withText: async (c) => c,
    });
    expect(feeds.map((f) => f.chapterIdx)).toEqual([0]);
  });
});
