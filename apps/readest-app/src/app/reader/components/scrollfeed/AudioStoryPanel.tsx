'use client';

// The Listen section: the whole book as an audio story of about an hour,
// narrated chapter after chapter. A chapter's script is written when it is
// first played (cached after), and the next one is written while this one plays.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MdGraphicEq, MdPause, MdPlayArrow, MdSkipNext, MdSkipPrevious } from 'react-icons/md';

import {
  chapterScriptWords,
  generateChapterScript,
  isUsableScript,
  WORDS_PER_MINUTE,
  type AudioScript,
} from '@/services/scrollfeed/audiostory';
import type { FeedChapter } from '@/services/scrollfeed/chapters';
import type { FeedStyle } from '@/services/scrollfeed/genre';
import { FEED_SPEEDS, type FeedVoice } from '@/services/scrollfeed/playback';
import {
  loadAudioProgress,
  loadAudioScript,
  saveAudioProgress,
  saveAudioScript,
  type AudioProgress,
} from '@/services/scrollfeed/store';
import { EdgeSpeaker } from '@/services/tts/aiSpeaker';
import { mathToSpeech } from '@/utils/mathText';

interface AudioStoryPanelProps {
  bookHash: string;
  bookTitle: string;
  chapters: FeedChapter[];
  style: FeedStyle | null;
  language: string | null;
  /** A chapter with its text, reading a scanned chapter's pages if needed. */
  withText: (chapter: FeedChapter) => Promise<FeedChapter>;
  voices: FeedVoice[];
  voiceId: string;
  onVoiceChange: (id: string) => void;
  voiceLang: string;
  rate: number;
  onRateChange: (rate: number) => void;
}

const minutesOf = (words: number) => Math.max(1, Math.round(words / WORDS_PER_MINUTE));

const AudioStoryPanel: React.FC<AudioStoryPanelProps> = ({
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
  const [position, setPosition] = useState<AudioProgress>({ chapterIdx: 0, paragraph: 0 });
  const [script, setScript] = useState<AudioScript | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Bumped to restart speech from `paragraph` (a chapter tapped again).
  const [seek, setSeek] = useState(0);
  const speakerRef = useRef<EdgeSpeaker | null>(null);
  const prefetchedRef = useRef<Set<string>>(new Set());

  const chapter = chapters[position.chapterIdx] ?? null;
  const { chapterIdx, paragraph } = position;

  // Pick up where listening stopped, without writing anything until Play.
  useEffect(() => {
    void loadAudioProgress(bookHash).then((saved) => {
      if (saved) setPosition(saved);
    });
  }, [bookHash]);

  useEffect(() => {
    void saveAudioProgress(bookHash, { chapterIdx, paragraph });
  }, [bookHash, chapterIdx, paragraph]);

  // The cached script, or a new one written — only once Play is pressed.
  const scriptFor = useCallback(
    async (listed: FeedChapter, cachedOnly: boolean): Promise<AudioScript | null> => {
      if (!style || !language) return null;
      const cached = await loadAudioScript(bookHash, listed.idx);
      if (cached && isUsableScript(cached, listed, style, language)) return cached;
      if (cachedOnly) return null;
      const full = await withText(listed);
      const words = chapterScriptWords(chapters, listed.idx);
      const written = await generateChapterScript(full, bookTitle, style, language, words);
      if (written.paragraphs.length) await saveAudioScript(bookHash, written);
      return written;
    },
    [bookHash, bookTitle, chapters, style, language, withText],
  );

  // Held in a ref: reading a scanned chapter's pages updates the chapter list,
  // and restarting on that would cancel the script being written and pay for
  // it twice.
  const scriptForRef = useRef(scriptFor);
  scriptForRef.current = scriptFor;

  const scriptReady =
    !!script &&
    script.chapterIdx === chapterIdx &&
    script.style === style &&
    script.language === language;
  const hasChapter = !!chapter;
  useEffect(() => {
    const listed = chapters[chapterIdx];
    if (!listed || scriptReady) return;
    let cancelled = false;
    if (playing) setBusy(true);
    void scriptForRef
      .current(listed, !playing)
      .then((next) => !cancelled && setScript(next))
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not write the audio story.');
        setPlaying(false);
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // `chapters` is read, not watched: only which chapter it is matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIdx, hasChapter, scriptReady, playing]);

  // Where to start speaking from, read when playback (re)starts. Not a
  // dependency: the paragraph advances as it is spoken, and restarting on
  // each one is what left a gap between paragraphs.
  const paragraphRef = useRef(paragraph);
  paragraphRef.current = paragraph;

  // Speak the rest of the chapter in one go, so the next paragraph's audio is
  // fetched while this one plays; past the last one, the next chapter starts,
  // so the whole book plays through hands-free.
  useEffect(() => {
    if (!playing || !scriptReady || !script) return;
    const start = paragraphRef.current;
    const speaker = (speakerRef.current ??= new EdgeSpeaker());
    let cancelled = false;
    void speaker
      .playParts(
        script.paragraphs.slice(start).map(mathToSpeech),
        voiceId,
        voiceLang,
        rate,
        (i) => !cancelled && setPosition({ chapterIdx, paragraph: start + i }),
      )
      .then(() => {
        if (cancelled) return;
        if (chapterIdx + 1 < chapters.length)
          setPosition({ chapterIdx: chapterIdx + 1, paragraph: 0 });
        else setPlaying(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Playback failed');
        setPlaying(false);
      });
    return () => {
      cancelled = true;
      speaker.stop();
    };
  }, [playing, scriptReady, script, chapterIdx, chapters.length, voiceId, voiceLang, rate, seek]);

  // Write the next chapter while this one plays, so the story doesn't pause.
  useEffect(() => {
    const next = chapters[chapterIdx + 1];
    const key = `${chapterIdx + 1}:${style}:${language}`;
    if (!playing || !scriptReady || !next || prefetchedRef.current.has(key)) return;
    prefetchedRef.current.add(key);
    void scriptFor(next, false).catch(() => prefetchedRef.current.delete(key));
  }, [playing, scriptReady, chapterIdx, chapters, style, language, scriptFor]);

  useEffect(() => () => speakerRef.current?.stop(), []);

  const playChapter = (idx: number) => {
    setError('');
    setPosition({ chapterIdx: idx, paragraph: 0 });
    setSeek((n) => n + 1);
    setPlaying(true);
  };

  const totalMinutes = minutesOf(
    chapters.reduce((sum, _, i) => sum + chapterScriptWords(chapters, i), 0),
  );
  const paragraphs = scriptReady ? script!.paragraphs : [];

  return (
    <div className='flex flex-col gap-4'>
      <div className='bg-base-200/60 eink-bordered rounded-xl p-4'>
        <p className='text-base-content/60 text-xs uppercase tracking-wide'>
          Audio story · about {totalMinutes} min
        </p>
        <h3 className='mt-1 truncate text-base font-semibold'>
          {chapter?.title ?? 'Reading book…'}
        </h3>
        <p className='text-base-content/80 mt-2 line-clamp-4 min-h-[5em] text-sm leading-relaxed'>
          {error ||
            (busy
              ? `Writing the audio story for ${chapter?.title}…`
              : (paragraphs[paragraph] ?? 'Press play to hear the whole book, retold.'))}
        </p>
        <div className='mt-3 flex items-center justify-center gap-4'>
          <button
            type='button'
            aria-label='Previous chapter'
            disabled={chapterIdx === 0}
            onClick={() => playChapter(chapterIdx - 1)}
            className='btn btn-ghost btn-circle'
          >
            <MdSkipPrevious size={26} />
          </button>
          <button
            type='button'
            aria-label={playing ? 'Pause audio story' : 'Play audio story'}
            aria-pressed={playing}
            disabled={!chapter || !style || !language}
            onClick={() => {
              setError('');
              setPlaying((on) => !on);
            }}
            className='btn btn-contrast btn-circle btn-lg'
          >
            {playing ? <MdPause size={30} /> : <MdPlayArrow size={30} />}
          </button>
          <button
            type='button'
            aria-label='Next chapter'
            disabled={chapterIdx + 1 >= chapters.length}
            onClick={() => playChapter(chapterIdx + 1)}
            className='btn btn-ghost btn-circle'
          >
            <MdSkipNext size={26} />
          </button>
        </div>
        <div className='mt-3 flex items-center gap-2'>
          {/* Cycles, like the feed's: the control most often changed mid-listen. */}
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
              className='select select-sm eink-bordered min-w-0 max-w-40'
            >
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          )}
          {paragraphs.length > 0 && (
            <span className='ml-auto shrink-0 text-xs tabular-nums opacity-60'>
              {Math.min(paragraph + 1, paragraphs.length)} / {paragraphs.length}
            </span>
          )}
        </div>
        {busy && <progress className='progress mt-3 w-full' />}
      </div>

      <ul className='flex flex-col gap-1'>
        {chapters.map((c) => (
          <li key={c.idx}>
            <button
              type='button'
              onClick={() => playChapter(c.idx)}
              disabled={!style || !language}
              aria-current={c.idx === chapterIdx}
              className='hover:bg-base-200/70 eink-bordered flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left disabled:opacity-50'
            >
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>{c.title}</span>
                <span className='text-base-content/50 text-xs'>
                  {minutesOf(chapterScriptWords(chapters, c.idx))} min listen
                </span>
              </span>
              {c.idx === chapterIdx && playing && (
                <MdGraphicEq size={18} className='text-primary shrink-0' aria-hidden='true' />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AudioStoryPanel;
