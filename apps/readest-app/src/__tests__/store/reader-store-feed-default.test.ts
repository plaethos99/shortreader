// Each book opens the way the reader chose for it: the original pages or the
// curated feed. The first open asks (ReadingModeChooser); until then the book
// itself is underneath.
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/store/settingsStore', () => {
  const { create } = require('zustand');
  return { useSettingsStore: create(() => ({ settings: {} })) };
});
vi.mock('@/store/libraryStore', () => {
  const { create } = require('zustand');
  return { useLibraryStore: create(() => ({ library: [], getBookByHash: vi.fn() })) };
});
vi.mock('@/utils/misc', () => ({ uniqueId: vi.fn(() => 'uid') }));
vi.mock('@/services/nav', () => ({ updateToc: vi.fn() }));
vi.mock('@/utils/book', () => ({
  formatTitle: vi.fn((t: string) => t),
  getMetadataHash: vi.fn(() => 'hash'),
  getPrimaryLanguage: vi.fn(() => 'en'),
}));
vi.mock('@/utils/path', () => ({ getBaseFilename: vi.fn((n: string) => n) }));
vi.mock('@/services/constants', () => ({ SUPPORTED_LANGNAMES: {} }));
vi.mock('@/libs/document', () => ({ DocumentLoader: vi.fn() }));
vi.mock('@/services/opds/pseStream', () => ({
  isPseStreamFileName: () => false,
  openPseStreamBook: vi.fn(),
  parsePseStreamFileName: vi.fn(),
}));
vi.mock('@/services/rss/feedBookUrl', () => ({ isFeedBookUrl: () => false }));
vi.mock('@/services/rss/feedReader', () => ({ openFeedBookDoc: vi.fn() }));
const modes = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@/services/readingMode', () => ({
  getReadingMode: (hash: string) => modes.value[hash] ?? null,
}));

import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { DocumentLoader } from '@/libs/document';

const open = async (savedScrollFeed: boolean) => {
  // A comic: skips the EPUB nav cache, which has nothing to do with the feed.
  const book = { hash: 'b', format: 'CBZ', title: 'B' };
  vi.mocked(DocumentLoader).mockImplementation(function () {
    const bookDoc = {
      metadata: { title: 'B' },
      rendition: { layout: 'pre-paginated' },
      sections: [],
    };
    return { open: async () => ({ book: bookDoc, format: 'CBZ' }) };
  } as never);
  vi.mocked(useLibraryStore.getState().getBookByHash).mockReturnValue(book as never);
  const appService = {
    loadBookContent: async () => ({ file: new File([], 'b.cbz') }),
    resolveNativeBookFilePath: async () => null,
    loadBookConfig: async () => ({
      viewSettings: { scrollFeed: savedScrollFeed },
      updatedAt: 0,
    }),
  };
  await useReaderStore
    .getState()
    .initViewState({ getAppService: async () => appService } as never, 'b', 'b-1');
  return useReaderStore.getState().getViewSettings('b-1')?.scrollFeed;
};

describe('opening a book', () => {
  beforeEach(() => {
    modes.value = {};
  });

  test('opens in the curated feed when the reader chose it for this book', async () => {
    modes.value = { b: 'curated' };
    expect(await open(false)).toBe(true);
  });

  test('opens the original when the reader chose it', async () => {
    modes.value = { b: 'original' };
    expect(await open(true)).toBe(false);
  });

  test('shows the book itself under the first-open question', async () => {
    expect(await open(true)).toBe(false);
  });
});
