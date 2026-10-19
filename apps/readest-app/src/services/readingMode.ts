/**
 * How the reader wants to read each book: the original pages, or the curated
 * feed. Asked the first time a book is opened (ReadingModeChooser), then
 * remembered per book on this device; switching views later updates it.
 */
export type ReadingMode = 'original' | 'curated';

const STORAGE_KEY = 'shortreader.reading-mode';

const load = (): Record<string, ReadingMode> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ReadingMode>) : {};
  } catch {
    return {};
  }
};

/** The book's chosen mode, or null when the reader hasn't chosen yet. */
export const getReadingMode = (bookHash: string): ReadingMode | null => {
  const mode = load()[bookHash];
  return mode === 'original' || mode === 'curated' ? mode : null;
};

export const setReadingMode = (bookHash: string, mode: ReadingMode): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...load(), [bookHash]: mode }));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
};
