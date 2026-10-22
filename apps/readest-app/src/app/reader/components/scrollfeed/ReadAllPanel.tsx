'use client';

// "Read all": every chapter's curated cards in one place, read aloud as one
// continuous recording that keeps playing with the phone locked or the window
// minimized. Chapters are announced, listed with where they start, and can be
// jumped to; next / previous chapter also work from the lock screen and media
// keys. See services/scrollfeed/bookAudio.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdGraphicEq, MdPause, MdPlayArrow, MdSkipNext, MdSkipPrevious } from 'react-icons/md';

import { EdgeSpeechTTS } from '@/libs/edgeTTS';
import { isTauriAppPlatform } from '@/services/environment';
import {
  bookSections,
  synthesizeBookAudio,
  type BookAudio,
  type BookSection,
} from '@/services/scrollfeed/bookAudio';
import { BookAudioPlayer } from '@/services/scrollfeed/bookAudioPlayer';
import { loadRecording, recordingKey, saveRecording } from '@/services/scrollfeed/bookAudioStore';
import type { FeedChapter } from '@/services/scrollfeed/chapters';
import { loadAllChapterFeeds, loadUsableFeed } from '@/services/scrollfeed/feedCache';
import type { FeedStyle } from '@/services/scrollfeed/genre';
import { FEED_SPEEDS, type FeedVoice } from '@/services/scrollfeed/playback';

interface ReadAllPanelProps {
  bookHash: string;
  bookTitle: string;
  chapters: FeedChapter[];
  style: FeedStyle | null;
  language: string | null;
  withText: (chapter: FeedChapter) => Promise<FeedChapter>;
  voices: FeedVoice[];
  voiceId: string;
  onVoiceChange: (id: string) => void;
  voiceLang: string;
  rate: number;
  onRateChange: (rate: number) => void;
}

type Phase = 'idle' | 'curating' | 'recording' | 'ready';

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const ReadAllPanel: React.FC<ReadAllPanelProps> = ({
  bookHash,
  bookTitle,
  chapters,
  style,
  language,
  withText,
  voices,
  voiceId,
  onVoiceChange,
  voiceLang,
  rate,
  onRateChange,
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [curated, setCurated] = useState<number | null>(null);
  const [sections, setSections] = useState<BookSection[]>([]);
  const [audio, setAudio] = useState<BookAudio | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState('');
  const playerRef = useRef<BookAudioPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const key = useMemo(
    () => (style && language ? recordingKey({ language, style, voiceId, chapters }) : null),
    [language, style, voiceId, chapters],
  );

  // How many chapters are curated already (free), and a kept recording.
  useEffect(() => {
    let cancelled = false;
    setCurated(null);
    if (!style || !language || !key) return;
    void (async () => {
      let ready = 0;
      for (const chapter of chapters) {
        if (chapter.text && (await loadUsableFeed(bookHash, chapter, style, language))) ready++;
      }
      if (!cancelled) setCurated(ready);
      const saved = await loadRecording(bookHash, key);
      if (saved && !cancelled && phase === 'idle') await adoptRecording(saved, null);
    })();
    return () => {
      cancelled = true;
    };
    // adoptRecording is stable; phase is only checked, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookHash, chapters, style, language, key]);

  // A new voice, style, language or chapter list makes the recording stale.
  useEffect(() => {
    if (phase !== 'ready') return;
    playerRef.current?.destroy();
    playerRef.current = null;
    setAudio(null);
    setPlaying(false);
    setPhase('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      playerRef.current?.destroy();
    },
    [],
  );

  // While playing: where we are, and which chapter (also for the lock screen).
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      setTime(player.currentTime);
      setCurrent(player.chapterIndex);
      player.syncChapter();
    }, 500);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    playerRef.current?.setRate(rate);
  }, [rate]);

  const adoptRecording = useCallback(
    async (recorded: BookAudio, feedSections: BookSection[] | null) => {
      playerRef.current?.destroy();
      const player = new BookAudioPlayer();
      playerRef.current = player;
      await player.load(recorded, bookHash, bookTitle, {
        onEnded: () => setPlaying(false),
      });
      player.setRate(rate);
      setAudio(recorded);
      if (feedSections) setSections(feedSections);
      setTime(0);
      setCurrent(0);
      setPhase('ready');
    },
    [bookHash, bookTitle, rate],
  );

  // The text of every chapter, shown even for a kept recording.
  useEffect(() => {
    if (phase !== 'ready' || sections.length || !style || !language) return;
    let cancelled = false;
    void (async () => {
      const feeds = [];
      for (const chapter of chapters) {
        const feed = chapter.text ? await loadUsableFeed(bookHash, chapter, style, language) : null;
        if (feed) feeds.push(feed);
      }
      if (!cancelled) setSections(bookSections(feeds, language));
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, sections.length, chapters, bookHash, style, language]);

  const prepare = async () => {
    if (!style || !language || !key) return;
    setError('');
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      setPhase('curating');
      setProgress({ done: 0, total: chapters.length });
      const feeds = await loadAllChapterFeeds({
        bookHash,
        bookTitle,
        chapters,
        style,
        language,
        withText,
        signal: abort.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const spoken = bookSections(feeds, language);
      setSections(spoken);

      setPhase('recording');
      setProgress({ done: 0, total: 1 });
      const tts = new EdgeSpeechTTS(isTauriAppPlatform() ? 'wss' : 'https');
      // Recorded at normal speed; the speed control changes playback, so it
      // can change without recording again.
      const recorded = await synthesizeBookAudio(spoken, {
        synth: async (text) =>
          (await tts.createAudioData({ lang: voiceLang, text, voice: voiceId, rate: 1, pitch: 1 }))
            .data,
        signal: abort.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      await saveRecording(bookHash, key, recorded).catch(() => {});
      await adoptRecording(recorded, spoken);
    } catch (e) {
      setPhase('idle');
      if (!abort.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Could not prepare the book.');
      }
    } finally {
      abortRef.current = null;
    }
  };

  const toggle = async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (player.paused) {
        await player.play();
        setPlaying(true);
      } else {
        player.pause();
        setPlaying(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Playback failed');
    }
  };

  const goTo = async (index: number) => {
    const player = playerRef.current;
    if (!player || !audio) return;
    await player.goToChapter(index);
    setCurrent(index);
    setTime(audio.chapters[index]?.startSec ?? 0);
    if (player.paused) {
      await player.play();
      setPlaying(true);
    }
  };

  const recordedChapters = audio?.chapters ?? [];
  const chapterTitle = recordedChapters[current]?.title;
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const toCurate = curated === null ? null : chapters.length - curated;

  return (
    <div className='flex flex-col gap-4'>
      <div className='bg-base-200/60 eink-bordered rounded-xl p-4'>
        <p className='text-base-content/60 text-xs uppercase tracking-wide'>
          Read all · {chapters.length} chapters
          {audio ? ` · ${clock(audio.durationSec)}` : ''}
        </p>

        {phase === 'ready' && audio ? (
          <>
            <h3 className='mt-1 truncate text-base font-semibold'>
              {chapterTitle ? `${current + 1}. ${chapterTitle}` : bookTitle}
            </h3>
            <div className='mt-3'>
              <progress
                className='progress w-full'
                value={time}
                max={Math.max(1, audio.durationSec)}
              />
              <div className='text-base-content/60 flex justify-between text-xs tabular-nums'>
                <span>{clock(time)}</span>
                <span>{clock(audio.durationSec)}</span>
              </div>
            </div>
            <div className='mt-2 flex items-center justify-center gap-4'>
              <button
                type='button'
                aria-label='Previous chapter'
                disabled={current === 0}
                onClick={() => void goTo(current - 1)}
                className='btn btn-ghost btn-circle'
              >
                <MdSkipPrevious size={26} />
              </button>
              <button
                type='button'
                aria-label={playing ? 'Pause' : 'Play the whole book'}
                aria-pressed={playing}
                onClick={() => void toggle()}
                className='btn btn-contrast btn-circle btn-lg'
              >
                {playing ? <MdPause size={30} /> : <MdPlayArrow size={30} />}
              </button>
              <button
                type='button'
                aria-label='Next chapter'
                disabled={current + 1 >= recordedChapters.length}
                onClick={() => void goTo(current + 1)}
                className='btn btn-ghost btn-circle'
              >
                <MdSkipNext size={26} />
              </button>
            </div>
          </>
        ) : (
          <>
            <p className='text-base-content/80 mt-2 text-sm leading-relaxed'>
              Every chapter’s curated cards, read aloud as one recording — it keeps playing with
              your phone locked or the window minimized, and announces each chapter.
            </p>
            {phase === 'idle' && (
              <>
                {toCurate !== null && toCurate > 0 && (
                  <p className='text-base-content/60 mt-2 text-xs'>
                    {toCurate} of {chapters.length} chapters aren’t curated yet; preparing curates
                    them with your AI key.
                  </p>
                )}
                <button
                  type='button'
                  disabled={!style || !language || chapters.length === 0}
                  onClick={() => void prepare()}
                  className='btn btn-primary btn-sm mt-3'
                >
                  Prepare the whole book
                </button>
              </>
            )}
            {(phase === 'curating' || phase === 'recording') && (
              <div className='mt-3'>
                <p className='text-sm'>
                  {phase === 'curating'
                    ? `Curating chapters… ${progress.done} of ${progress.total}`
                    : `Recording… ${percent}%`}
                </p>
                <progress
                  className='progress mt-2 w-full'
                  value={progress.done}
                  max={Math.max(1, progress.total)}
                />
                <button
                  type='button'
                  onClick={() => abortRef.current?.abort()}
                  className='btn btn-ghost btn-xs mt-2'
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        <div className='mt-3 flex items-center gap-2'>
          <button
            type='button'
            aria-label={`Playback speed ${rate}x`}
            onClick={() =>
              onRateChange(
                FEED_SPEEDS[
                  (FEED_SPEEDS.indexOf(rate as (typeof FEED_SPEEDS)[number]) + 1) %
                    FEED_SPEEDS.length
                ]!,
              )
            }
            className='btn btn-sm btn-ghost eink-bordered tabular-nums'
          >
            {rate}×
          </button>
          {voices.length > 1 && (
            <select
              aria-label='Narrator'
              value={voiceId}
              onChange={(e) => onVoiceChange(e.target.value)}
              disabled={phase === 'curating' || phase === 'recording'}
              className='select select-sm eink-bordered min-w-0 max-w-40'
            >
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {error && <p className='text-error mt-2 text-xs'>{error}</p>}
      </div>

      {/* The whole book's curated text in one place, by chapter. */}
      {sections.length > 0 && (
        <div className='flex flex-col gap-5'>
          {sections.map((section, i) => {
            const isCurrent = phase === 'ready' && i === current;
            return (
              <section key={section.chapterIdx} aria-current={isCurrent}>
                <button
                  type='button'
                  disabled={phase !== 'ready'}
                  onClick={() => void goTo(i)}
                  className='flex w-full items-center gap-2 text-left'
                >
                  <h4 className={`text-sm font-semibold ${isCurrent ? 'text-primary' : ''}`}>
                    {i + 1}. {section.title}
                  </h4>
                  {recordedChapters[i] && (
                    <span className='text-base-content/50 text-xs tabular-nums'>
                      {clock(recordedChapters[i]!.startSec)}
                    </span>
                  )}
                  {isCurrent && playing && (
                    <MdGraphicEq size={16} className='text-primary shrink-0' aria-hidden='true' />
                  )}
                </button>
                <div className='text-base-content/80 mt-2 flex flex-col gap-2 text-sm leading-relaxed'>
                  {section.parts.slice(1).map((text, k) => (
                    <p key={k}>{text}</p>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReadAllPanel;
