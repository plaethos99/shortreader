'use client';

/**
 * The language this book's feed is written in: the reader's saved choice, else
 * the book's own language when we offer it, else English.
 */
import { useCallback, useEffect, useState } from 'react';

import { resolveDefaultFeedLanguage } from '@/services/scrollfeed/language';
import { loadFeedLanguage, saveFeedLanguage } from '@/services/scrollfeed/store';

interface FeedLanguageState {
  // null until known; chapters must not be generated in the wrong language.
  language: string | null;
  setLanguage: (code: string) => void;
}

export const useFeedLanguage = (bookHash: string, bookLang: string): FeedLanguageState => {
  const [language, setLanguageState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadFeedLanguage(bookHash).then((saved) => {
      if (cancelled) return;
      setLanguageState(saved ?? resolveDefaultFeedLanguage(bookLang));
    });
    return () => {
      cancelled = true;
    };
  }, [bookHash, bookLang]);

  const setLanguage = useCallback(
    (code: string) => {
      setLanguageState(code);
      void saveFeedLanguage(bookHash, code);
    },
    [bookHash],
  );

  return { language, setLanguage };
};
