// AI Insights opened from a library card gets only the Book. It has to load
// the book's document itself, or the panel has no chapters to list.
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/libs/document', () => ({ DocumentLoader: vi.fn() }));
vi.mock('@/services/rss/feedReader', () => ({ openFeedBookDoc: vi.fn() }));

import { DocumentLoader } from '@/libs/document';
import { openFeedBookDoc } from '@/services/rss/feedReader';
import { useBookDataStore } from '@/store/bookDataStore';
import { buildFeedBookUrl } from '@/services/rss/feedBookUrl';
import { loadBookDoc } from '@/services/aiBookDoc';

const doc = { metadata: { title: 'Doc' }, sections: [] };

const appService = {
  loadBookContent: vi.fn(async () => ({ file: new File([], 'b.epub') })),
  resolveNativeBookFilePath: vi.fn(async () => '/books/b.epub'),
};

describe('loadBookDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBookDataStore.setState({ booksData: {} });
    vi.mocked(DocumentLoader).mockImplementation(function () {
      return { open: async () => ({ book: doc, format: 'EPUB' }) };
    } as never);
  });

  test('opens a closed book from its file', async () => {
    const book = { hash: 'b', title: 'B' };
    await expect(loadBookDoc(appService as never, book as never)).resolves.toBe(doc);
    expect(appService.loadBookContent).toHaveBeenCalledWith(book);
    expect(DocumentLoader).toHaveBeenCalledWith(expect.any(File), {
      nativeFilePath: '/books/b.epub',
    });
  });

  test('reuses the document of a book that is already open', async () => {
    const open = { metadata: { title: 'Open' }, sections: [] };
    useBookDataStore.setState({ booksData: { b: { bookDoc: open } as never } });
    await expect(loadBookDoc(appService as never, { hash: 'b' } as never)).resolves.toBe(open);
    expect(appService.loadBookContent).not.toHaveBeenCalled();
  });

  test('opens a feed book from its manifest', async () => {
    vi.mocked(openFeedBookDoc).mockResolvedValue(doc as never);
    const book = { hash: 'f', title: 'Feed', url: buildFeedBookUrl('https://example.com/rss') };
    await expect(loadBookDoc(appService as never, book as never)).resolves.toBe(doc);
    expect(openFeedBookDoc).toHaveBeenCalledWith(
      appService,
      'f',
      'https://example.com/rss',
      'Feed',
    );
  });
});
