// Every book opens into the curated feed. The original book is a side door the
// reader can take for a session, not a choice remembered for the next open.
import { describe, expect, test, vi } from 'vitest';

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

import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { DocumentLoader } from '@/libs/document';

describe('opening a book', () => {
  test('lands in the curated feed even if the book was last read in the original', async () => {
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
      loadBookConfig: async () => ({ viewSettings: { scrollFeed: false }, updatedAt: 0 }),
    };

    await useReaderStore
      .getState()
      .initViewState({ getAppService: async () => appService } as never, 'b', 'b-1');

    expect(useReaderStore.getState().getViewSettings('b-1')?.scrollFeed).toBe(true);
  });
});
