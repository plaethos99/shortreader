'use client';

// Scroll feed — pick a chapter, then swipe through it as full-screen cards.
//
// Scoped to ONE chapter on purpose: the feed is a way to read a chapter, not a
// stitched-together replacement for the book. The cards follow the book's
// style — a novel retold as a story, a technical book as core concepts, a
// self-help book as techniques. Generated per chapter on demand and cached in
// IndexedDB.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdOutlineMenuBook } from 'react-icons/md';

import { BookDoc } from '@/libs/document';
import AiInsightsMark from '@/components/AiInsightsMark';
import { showAIKeys } from '@/components/AIKeysDialog';
import { textConfigProblem, useAIConfigStore } from '@/services/byok/aiConfig';
import { useBookDataStore } from '@/store/bookDataStore';
import { eventDispatcher } from '@/utils/event';
import { useScrollFeedSetting } from '@/app/reader/hooks/useScrollFeedSetting';
import { extractChapters, type FeedChapter } from '@/services/scrollfeed/chapters';
import { fillScannedChapter } from '@/services/scrollfeed/ocr';
import { generateChapterFeed } from '@/services/scrollfeed/generate';
import { loadUsableFeed, saveUsableFeed } from '@/services/scrollfeed/feedCache';
import type { FeedStyle } from '@/services/scrollfeed/genre';
import { feedLanguage } from '@/services/scrollfeed/language';
import { resumePoint, shouldPrefetchNext } from '@/services/scrollfeed/playback';
import { loadFeedProgress, saveFeedProgress, saveHighlight } from '@/services/scrollfeed/store';
import type { ChapterFeed, FeedCard } from '@/services/scrollfeed/types';
import FeedChrome from './FeedChrome';
import FeedControls from './FeedControls';
import ScrollFeedCard from './ScrollFeedCard';
import { useFeedPrefs } from './useFeedPrefs';
import AmbientBackground from '../ambience/AmbientBackground';
import { chapterDoneFeedback, keyInsightFeedback, tickFeedback } from '../ambience/feedback';
import { useBookAmbience } from '../ambience/useBookAmbience';
import { useFeedLook } from '../ambience/useFeedLook';
import { useReadingStats } from '../ambience/useReadingStats';
import AudioStoryPanel from './AudioStoryPanel';
import ReadAllPanel from './ReadAllPanel';
import ChapterEndCard from './ChapterEndCard';
import ChapterPicker from './ChapterPicker';
import FeedWindowBar, { FEED_WINDOW_BAR_HEIGHT, useHasFeedWindowBar } from './FeedWindowBar';
import { useEnv } from '@/context/EnvContext';
import { useFeedReadAlong } from './useFeedReadAlong';
import { useFeedLanguage } from './useFeedLanguage';
import { useFeedStyle } from './useFeedStyle';

// Stable identity for "no cards yet", so the read-along effect isn't restarted
// by a fresh [] on every render before a feed has loaded.
const EMPTY_CARDS: FeedCard[] = [];
const NOT_SET_UP = 'Add your AI key and choose a model to make the curated feed.';

interface ScrollFeedViewProps {
  bookKey: string;
  bookHash: string;
  bookDoc: BookDoc;
  bookTitle: string;
  contentInsets: { top: number; right: number; bottom: number; left: number };
  onCloseBook: (bookKey: string) => void;
}

const ScrollFeedView: React.FC<ScrollFeedViewProps> = ({
  bookKey,
  bookHash,
  bookDoc,
  bookTitle,
  contentInsets: readerInsets,
  onCloseBook,
}) => {
  // Desktop: the feed's own window bar sits above everything, so the feed
  // starts below it (see FeedWindowBar).
  const hasWindowBar = useHasFeedWindowBar();
  const contentInsets = useMemo(
    () =>
      hasWindowBar
        ? { ...readerInsets, top: readerInsets.top + FEED_WINDOW_BAR_HEIGHT }
        : readerInsets,
    [hasWindowBar, readerInsets],
  );
  const windowBar = hasWindowBar && (
    <FeedWindowBar title={bookTitle} onClose={() => onCloseBook(bookKey)} />
  );
  const { setEnabled } = useScrollFeedSetting(bookKey);
  const [chapters, setChapters] = useState<FeedChapter[]>([]);
  const [selected, setSelected] = useState<FeedChapter | null>(null);
  const [feed, setFeed] = useState<ChapterFeed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Pages of a scanned chapter read so far, while they are being read.
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null);
  const [activeCard, setActiveCard] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  // Card to land on once the feed renders, for resuming mid-chapter.
  const pendingCardRef = useRef(0);
  // Chapters already condensed ahead, so scrolling past the trigger repeatedly
  // doesn't fire a fresh Gemini call each time.
  const prefetchedRef = useRef<Set<number>>(new Set());
  const resumedRef = useRef(false);

  const bookLang = useMemo(() => {
    const lang = (bookDoc as { metadata?: { language?: string | string[] } })?.metadata?.language;
    return (Array.isArray(lang) ? lang[0] : lang) || 'en';
  }, [bookDoc]);

  const { language, setLanguage } = useFeedLanguage(bookHash, bookLang);
  // Read-along narrates the language the cards are WRITTEN in, not the book's.
  const voiceLang = feedLanguage(language ?? 'en').voiceLang;
  const prefs = useFeedPrefs(voiceLang);
  const { look, effective, setLook } = useFeedLook();
  const ambience = useBookAmbience(bookHash, bookDoc, bookTitle);
  const { appService } = useEnv();
  const stats = useReadingStats(!!feed && feed.cards.length > 0);

  // Re-checked when the reader saves their AI keys, so the feed starts then.
  const aiReady = useAIConfigStore((s) => textConfigProblem(s.config) === null);

  useEffect(() => {
    if (!aiReady) {
      setError(NOT_SET_UP);
      return;
    }
    setError((e) => (e === NOT_SET_UP ? '' : e));
    let cancelled = false;
    void extractChapters(bookDoc)
      .then((list) => {
        if (cancelled) return;
        setChapters(list);
        if (list.length === 0) setError('This book has no text the feed can read.');
      })
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not read book.'),
      );
    return () => {
      cancelled = true;
    };
  }, [bookDoc, aiReady]);

  const { style, setStyle } = useFeedStyle(bookHash, bookDoc, bookTitle, chapters);

  // A scanned chapter's text is read off its page images when first needed
  // (cached per page); every other chapter already has its text.
  const withText = useCallback(
    async (chapter: FeedChapter, onProgress?: (done: number, total: number) => void) => {
      if (!chapter.scannedSections || chapter.text) return chapter;
      const filled = await fillScannedChapter(bookDoc, bookHash, chapter, onProgress);
      setChapters((list) => list.map((c) => (c.idx === filled.idx ? filled : c)));
      return filled;
    },
    [bookDoc, bookHash],
  );

  const openChapter = useCallback(
    async (listed: FeedChapter, startCard = 0) => {
      if (!style || !language) return;
      setSelected(listed);
      setFeed(null);
      setActiveCard(startCard);
      pendingCardRef.current = startCard;
      setBusy(true);
      setError('');
      try {
        const chapter = await withText(listed, (done, total) => setOcrProgress({ done, total }));
        setOcrProgress(null);
        setSelected(chapter);
        const cached = await loadUsableFeed(bookHash, chapter, style, language);
        const result =
          cached ??
          (await generateChapterFeed(
            chapter.idx,
            chapter.title,
            chapter.text,
            bookTitle,
            style,
            language,
          ));
        if (!cached) await saveUsableFeed(bookHash, chapter, result);
        setFeed(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not retell this chapter.');
      } finally {
        setOcrProgress(null);
        setBusy(false);
      }
    },
    [bookHash, bookTitle, style, language, withText],
  );

  // A new style or language makes every prefetched chapter stale.
  const changeStyle = (next: FeedStyle) => {
    prefetchedRef.current = new Set();
    setStyle(next);
  };

  const changeLanguage = (next: string) => {
    prefetchedRef.current = new Set();
    setLanguage(next);
  };

  // Reopen where reading stopped rather than at the chapter list — the mode is
  // meant to be picked up and put down like a feed. Waits for the style, since
  // a chapter can't be opened without it.
  useEffect(() => {
    if (resumedRef.current || chapters.length === 0 || !style || !language) return;
    resumedRef.current = true;
    void loadFeedProgress(bookHash).then((progress) => {
      const point = resumePoint(chapters, progress);
      if (point) void openChapter(chapters[point.chapterIdx]!, point.cardIdx);
    });
  }, [chapters, bookHash, openChapter, style, language]);

  // Land on the resumed card once the track has laid its cards out. Instant,
  // not smooth: this is a restore, not a navigation.
  useEffect(() => {
    if (!feed) return;
    const index = pendingCardRef.current;
    pendingCardRef.current = 0;
    if (!index) return;
    requestAnimationFrame(() => {
      const el = trackRef.current;
      if (el) el.scrollTop = index * el.clientHeight;
    });
  }, [feed]);

  useEffect(() => {
    if (!selected || !feed) return;
    void saveFeedProgress(bookHash, { chapterIdx: selected.idx, cardIdx: activeCard });
  }, [bookHash, selected, feed, activeCard]);

  const prefetchChapter = useCallback(
    async (idx: number) => {
      if (!style || !language || idx >= chapters.length || prefetchedRef.current.has(idx)) return;
      prefetchedRef.current.add(idx);
      try {
        const chapter = await withText(chapters[idx]!);
        if (await loadUsableFeed(bookHash, chapter, style, language)) return;
        const result = await generateChapterFeed(
          idx,
          chapter.title,
          chapter.text,
          bookTitle,
          style,
          language,
        );
        await saveUsableFeed(bookHash, chapter, result);
      } catch {
        // Let a failed prefetch be retried; opening the chapter will surface
        // the error properly if it persists.
        prefetchedRef.current.delete(idx);
      }
    },
    [chapters, bookHash, bookTitle, style, language, withText],
  );

  // Condense the next chapter while there are still cards left in this one, so
  // reaching the end doesn't stall on a round trip.
  useEffect(() => {
    if (!feed || !selected) return;
    if (!shouldPrefetchNext(activeCard, feed.cards.length)) return;
    void prefetchChapter(selected.idx + 1);
  }, [activeCard, feed, selected, prefetchChapter]);

  // Which card is snapped into view drives the text animation.
  const handleScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    const index = Math.round(el.scrollTop / el.clientHeight);
    if (index !== activeCard) setActiveCard(index);
  };

  // A small reward as each card lands: a tick, a chime for a key insight, a
  // warmer one when the chapter is done. Not on the card a chapter opens at.
  const landedRef = useRef<string>('');
  useEffect(() => {
    if (!feed || !selected) return;
    const spot = `${selected.idx}:${activeCard}`;
    const first = !landedRef.current.startsWith(`${selected.idx}:`);
    if (landedRef.current === spot) return;
    landedRef.current = spot;
    if (first) return;
    const options = {
      sound: effective.sound,
      haptics: effective.haptics,
      nativeHaptics: !!appService?.hasHaptics,
    };
    if (activeCard >= feed.cards.length) chapterDoneFeedback(options);
    else if (feed.cards[activeCard]?.key) keyInsightFeedback(options);
    else tickFeedback(options);
  }, [activeCard, feed, selected, effective.sound, effective.haptics, appService]);

  const keepCard = useCallback(
    (card: FeedCard) => {
      if (!selected) return;
      void saveHighlight({
        bookHash,
        bookTitle,
        chapterTitle: selected.title,
        cardId: card.id,
        text: card.quote
          ? `${card.story}

“${card.quote}”`
          : card.story,
        savedAt: Date.now(),
      });
      if (effective.haptics) {
        tickFeedback({ sound: false, haptics: true, nativeHaptics: !!appService?.hasHaptics });
      }
    },
    [bookHash, bookTitle, selected, effective.haptics, appService],
  );

  // Read-along advances by scrolling, not by setting state directly, so the
  // snapped card and the spoken card can never disagree.
  const scrollToCard = useCallback((index: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ top: index * el.clientHeight, behavior: 'smooth' });
  }, []);

  const readAlong = useFeedReadAlong({
    cards: feed?.cards ?? EMPTY_CARDS,
    activeCard,
    onAdvance: scrollToCard,
    voiceId: prefs.voiceId,
    lang: voiceLang,
    rate: prefs.rate,
  });

  const insetStyle = {
    paddingTop: contentInsets.top,
    paddingBottom: contentInsets.bottom,
    paddingLeft: contentInsets.left,
    paddingRight: contentInsets.right,
  };

  // Only shown when the feed can't be made: then the book itself is the one
  // way to read. Otherwise the original sits behind the chapter list's More menu.
  const exitFeed = (
    <button
      type='button'
      onClick={() => setEnabled(false)}
      className='btn btn-sm btn-ghost eink-bordered gap-1'
    >
      <MdOutlineMenuBook size={16} />
      Read the book
    </button>
  );

  // AI Insights over the feed's own chapter list, so a chapter asked about
  // here is the same chapter in the panel. A chapter opens straight into chat.
  const askAi = (chapter: FeedChapter | null) =>
    eventDispatcher.dispatch('show-ai-panel', {
      book: useBookDataStore.getState().getBookData(bookKey)?.book,
      bookDoc,
      chapters,
      chapterIdx: chapter?.idx ?? -1,
      tab: chapter ? 'chat' : 'summary',
    });

  // Every screen of the feed sits on the same calm background. A function, not
  // a component: a component defined here would be a new type each render and
  // remount the whole feed (and restart the background) on every card.
  //
  // The content goes straight into the padded container, not a wrapper: the
  // floating header offsets itself by the top inset from the container's edge,
  // and inside a wrapper that already sat below the inset it was offset twice
  // and landed on the card text on phones. Content that must show above the
  // canvas is positioned (`relative`).
  const shell = (children: React.ReactNode, scroll = false) => (
    <div className='bg-base-100 absolute inset-0 z-10' style={insetStyle}>
      {windowBar}
      <AmbientBackground backdrop={effective.backdrop} palette={ambience.palette} />
      {scroll ? <div className='relative h-full overflow-y-auto'>{children}</div> : children}
    </div>
  );

  if (error && !selected) {
    return (
      <div className='bg-base-100 absolute inset-0 z-10 overflow-y-auto' style={insetStyle}>
        {windowBar}
        {/* The way out matters most here: a feed that cannot be generated is a
            blank screen where the book should be. */}
        <div className='mx-auto max-w-2xl p-6'>
          <p className='text-error mb-4 text-sm'>{error}</p>
          {error === NOT_SET_UP && (
            <button className='btn btn-primary btn-sm mb-4' onClick={showAIKeys}>
              Set up AI
            </button>
          )}
          {exitFeed}
        </div>
      </div>
    );
  }

  // Chapter picker.
  if (!selected) {
    return shell(
      <>
        <ChapterPicker
          bookTitle={bookTitle}
          onReadOriginal={() => setEnabled(false)}
          onAskAi={askAi}
          chapters={chapters}
          style={style}
          onStyleChange={changeStyle}
          language={language}
          onLanguageChange={changeLanguage}
          onOpen={(chapter) => void openChapter(chapter)}
          look={look}
          onLookChange={setLook}
          mood={ambience.mood}
          onMoodChange={ambience.setMood}
          streak={stats.streak}
          minutes={stats.minutes}
          listen={
            <AudioStoryPanel
              bookHash={bookHash}
              bookTitle={bookTitle}
              chapters={chapters}
              style={style}
              language={language}
              withText={withText}
              voices={prefs.voices}
              voiceId={prefs.voiceId}
              onVoiceChange={prefs.setVoiceId}
              voiceLang={voiceLang}
              rate={prefs.rate}
              onRateChange={prefs.setRate}
            />
          }
          readAll={
            <ReadAllPanel
              bookHash={bookHash}
              bookTitle={bookTitle}
              chapters={chapters}
              style={style}
              language={language}
              withText={withText}
              voices={prefs.voices}
              voiceId={prefs.voiceId}
              onVoiceChange={prefs.setVoiceId}
              voiceLang={voiceLang}
              rate={prefs.rate}
              onRateChange={prefs.setRate}
            />
          }
        />
      </>,
      true,
    );
  }

  const chrome = (controls?: React.ReactNode) => (
    <FeedChrome
      topInset={contentInsets.top}
      onBackToChapters={() => {
        setSelected(null);
        setFeed(null);
      }}
      askAi={
        <button
          type='button'
          onClick={() => askAi(selected)}
          className='btn btn-sm btn-ghost eink-bordered gap-1 pl-1.5'
        >
          <AiInsightsMark size={20} />
          Ask AI
        </button>
      }
      controls={controls}
    />
  );

  if (busy || !feed) {
    return shell(
      <>
        {chrome()}
        <div className='relative flex h-full flex-col items-center justify-center gap-3 px-6'>
          <p className='text-sm'>
            {error ||
              (ocrProgress
                ? `Reading scanned pages ${ocrProgress.done}/${ocrProgress.total}…`
                : `Retelling ${selected.title}…`)}
          </p>
          {!error && <progress className='progress w-56' />}
        </div>
      </>,
    );
  }

  if (feed.cards.length === 0) {
    return shell(
      <>
        {chrome()}
        <div className='relative flex h-full items-center justify-center px-6'>
          <p className='text-base-content/60 max-w-sm text-center text-sm'>
            Nothing could be retold from this chapter.
          </p>
        </div>
      </>,
    );
  }

  const nextChapter = chapters[selected.idx + 1] ?? null;
  const progress = Math.min(100, ((activeCard + 1) / feed.cards.length) * 100);

  return shell(
    <>
      {/* How far through the chapter: a thin line that fills as cards pass. */}
      <div className='absolute inset-x-0 z-30 h-0.5' style={{ top: contentInsets.top }}>
        <div
          className='bg-primary/70 h-full transition-[width] duration-500 ease-out'
          style={{ width: `${progress}%` }}
        />
      </div>
      {chrome(
        <FeedControls
          playing={readAlong.playing}
          onToggle={readAlong.toggle}
          voices={prefs.voices}
          voiceId={prefs.voiceId}
          onVoiceChange={prefs.setVoiceId}
          rate={prefs.rate}
          onRateChange={prefs.setRate}
          position={Math.min(activeCard + 1, feed.cards.length)}
          total={feed.cards.length}
        />,
      )}

      {readAlong.error && (
        <p
          className='text-error absolute inset-x-0 bottom-3 z-20 text-center text-xs'
          role='status'
        >
          {readAlong.error}
        </p>
      )}
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className='relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain'
      >
        {feed.cards.map((card, i) => (
          <ScrollFeedCard
            key={card.id}
            card={card}
            bookHash={bookHash}
            active={i === activeCard}
            motion={effective.motion}
            onLongPress={keepCard}
          />
        ))}
        <ChapterEndCard
          active={activeCard === feed.cards.length}
          cardCount={feed.cards.length}
          bookMinutes={Math.max(1, Math.round(selected.text.length / 1800))}
          teaser={feed.teaser ?? ''}
          nextTitle={nextChapter?.title ?? null}
          onNext={() => nextChapter && void openChapter(nextChapter)}
        />
      </div>
    </>,
  );
};

export default ScrollFeedView;
