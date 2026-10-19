import { DocumentLoader, type BookDoc } from '@/libs/document';
import { useBookDataStore } from '@/store/bookDataStore';
import { isFeedBook, parseFeedBookUrl } from '@/services/rss/feedBookUrl';
import { openFeedBookDoc } from '@/services/rss/feedReader';
import type { Book } from '@/types/book';
import type { AppService, FileSystem } from '@/types/system';

/**
 * The parsed document behind a book, for AI Insights.
 *
 * The reader hands the panel the document it already has open; a library card
 * has only the Book, and without its document the panel had no chapters to
 * list ("Open from the reader to list chapters").
 */
export async function loadBookDoc(appService: AppService, book: Book): Promise<BookDoc> {
  const open = useBookDataStore.getState().booksData[book.hash]?.bookDoc;
  if (open) return open;
  if (isFeedBook(book)) {
    const { feedUrl } = parseFeedBookUrl(book.url!);
    // AppService exposes the FileSystem surface the feed manifest needs.
    const fs = appService as unknown as FileSystem;
    return openFeedBookDoc(fs, book.hash, feedUrl, book.title);
  }
  const [content, nativeFilePath] = await Promise.all([
    appService.loadBookContent(book),
    appService.resolveNativeBookFilePath(book).catch(() => null),
  ]);
  const { book: bookDoc } = await new DocumentLoader(content.file, {
    nativeFilePath: nativeFilePath ?? undefined,
  }).open();
  return bookDoc;
}
