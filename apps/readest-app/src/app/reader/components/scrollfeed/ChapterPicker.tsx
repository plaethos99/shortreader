'use client';

// The feed's first screen: the book's chapters, the style and language they
// are retold in, the look of the feed, the reader's highlights and streak.
import React, { useState } from 'react';
import {
  MdBookmarkBorder,
  MdHeadphones,
  MdLocalFireDepartment,
  MdMoreHoriz,
  MdOutlineMenuBook,
  MdPalette,
  MdViewDay,
} from 'react-icons/md';

import AiInsightsMark from '@/components/AiInsightsMark';
import type { FeedChapter } from '@/services/scrollfeed/chapters';
import { FEED_STYLE_LABELS, FEED_STYLES, type FeedStyle } from '@/services/scrollfeed/genre';
import { FEED_LANGUAGE_GROUPS } from '@/services/scrollfeed/language';
import type { FeedMood } from '@/services/scrollfeed/ambience';
import type { FeedLook } from '@/services/scrollfeed/store';
import HighlightsPanel from './HighlightsPanel';
import LookPanel from './LookPanel';

interface ChapterPickerProps {
  bookTitle: string;
  /** The book in its original form — kept behind the More menu. */
  onReadOriginal: () => void;
  /** AI Insights for a chapter, or for the whole book when null. */
  onAskAi: (chapter: FeedChapter | null) => void;
  chapters: FeedChapter[];
  style: FeedStyle | null;
  onStyleChange: (style: FeedStyle) => void;
  language: string | null;
  onLanguageChange: (code: string) => void;
  onOpen: (chapter: FeedChapter) => void;
  look: FeedLook;
  onLookChange: (look: FeedLook) => void;
  mood: FeedMood | null;
  onMoodChange: (mood: FeedMood) => void;
  streak: number;
  minutes: number;
  /** The Listen section: the book as an audio story. */
  listen: React.ReactNode;
}

type Panel = 'look' | 'highlights' | null;
type Section = 'read' | 'listen';

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'read', label: 'Feed', icon: <MdViewDay size={16} /> },
  { id: 'listen', label: 'Listen', icon: <MdHeadphones size={16} /> },
];

const ChapterPicker: React.FC<ChapterPickerProps> = ({
  bookTitle,
  onReadOriginal,
  onAskAi,
  chapters,
  style,
  onStyleChange,
  language,
  onLanguageChange,
  onOpen,
  look,
  onLookChange,
  mood,
  onMoodChange,
  streak,
  minutes,
  listen,
}) => {
  const [section, setSection] = useState<Section>('read');
  const [panel, setPanel] = useState<Panel>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const toggle = (next: Panel) => setPanel((open) => (open === next ? null : next));

  return (
    <div className='mx-auto max-w-2xl p-5'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <h2 className='truncate text-lg font-semibold'>{bookTitle}</h2>
        <div className='relative flex shrink-0 items-center gap-1'>
          <button
            type='button'
            onClick={() => onAskAi(null)}
            className='eink-bordered inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-linear-to-br from-amber-200/25 via-rose-200/15 to-violet-300/25 py-1.5 pl-1.5 pr-3 text-sm font-medium shadow-sm transition hover:border-violet-400/60 hover:shadow-md eink:bg-none'
          >
            <AiInsightsMark size={22} />
            AI Insights
          </button>
          <button
            type='button'
            aria-label='More'
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            className='btn btn-sm btn-ghost btn-circle'
          >
            <MdMoreHoriz size={20} />
          </button>
          {moreOpen && (
            <div className='bg-base-100 border-base-300 absolute right-0 top-full z-10 mt-1 rounded-lg border p-1 shadow-lg'>
              <button
                type='button'
                onClick={() => {
                  setMoreOpen(false);
                  onReadOriginal();
                }}
                className='btn btn-sm btn-ghost w-full justify-start gap-2 whitespace-nowrap font-normal'
              >
                <MdOutlineMenuBook size={16} />
                Original book
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Progress that follows reading, not opening the app. */}
      {(streak > 0 || minutes > 0) && (
        <p className='text-base-content/70 mb-4 flex items-center gap-1.5 text-sm'>
          <MdLocalFireDepartment size={18} className='text-primary' />
          {streak > 0 ? `${streak}-day streak` : 'Start a streak today'}
          <span aria-hidden='true'>·</span>
          {minutes} min this week
        </p>
      )}

      {/* Two ways through the book: read it as a feed of cards, or listen to
          it as an audio story. */}
      <div
        role='tablist'
        aria-label='Read or listen'
        className='bg-base-200/70 eink-bordered mb-4 grid grid-cols-2 gap-1 rounded-full p-1'
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type='button'
            role='tab'
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            className={`flex items-center justify-center gap-1.5 rounded-full py-1.5 text-sm font-medium transition ${
              section === s.id
                ? 'bg-base-100 shadow-sm eink:border eink:border-base-content'
                : 'text-base-content/60 hover:text-base-content'
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      {/* Style is detected from the book and language defaults to the book's
          own; both are the reader's to change, and changing either
          regenerates the chapters in the new shape. */}
      {chapters.length > 0 && (
        <div className='text-base-content/70 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'>
          <label className='flex items-center gap-2'>
            Style
            <select
              className='select select-bordered select-sm eink-bordered'
              value={style ?? ''}
              disabled={!style}
              onChange={(e) => onStyleChange(e.target.value as FeedStyle)}
            >
              {!style && <option value=''>Detecting…</option>}
              {FEED_STYLES.map((s) => (
                <option key={s} value={s}>
                  {FEED_STYLE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className='flex items-center gap-2'>
            Language
            <select
              className='select select-bordered select-sm eink-bordered'
              value={language ?? ''}
              disabled={!language}
              onChange={(e) => onLanguageChange(e.target.value)}
            >
              <option value='en'>English</option>
              {FEED_LANGUAGE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.native === l.label ? l.native : `${l.native} · ${l.label}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className={`flex items-center gap-2 ${section === 'read' ? '' : 'hidden'}`}>
            <button
              type='button'
              aria-expanded={panel === 'look'}
              onClick={() => toggle('look')}
              className='btn btn-sm btn-ghost eink-bordered gap-1'
            >
              <MdPalette size={16} /> Look
            </button>
            <button
              type='button'
              aria-expanded={panel === 'highlights'}
              onClick={() => toggle('highlights')}
              className='btn btn-sm btn-ghost eink-bordered gap-1'
            >
              <MdBookmarkBorder size={16} /> Highlights
            </button>
          </div>
        </div>
      )}

      {/* Kept mounted while hidden, so the story keeps playing while the
          reader browses the feed's chapter list. */}
      <div hidden={section !== 'listen'}>{listen}</div>

      {section === 'read' && (
        <>
          {panel === 'look' && (
            <LookPanel
              look={look}
              onLookChange={onLookChange}
              mood={mood}
              onMoodChange={onMoodChange}
            />
          )}
          {panel === 'highlights' && <HighlightsPanel />}

          {chapters.length === 0 && <p className='text-base-content/60 text-sm'>Reading book…</p>}
          <ul className='flex flex-col gap-1'>
            {chapters.map((chapter) => (
              <li key={chapter.idx} className='flex items-center gap-1'>
                <button
                  type='button'
                  onClick={() => onOpen(chapter)}
                  disabled={!style}
                  className='hover:bg-base-200/70 eink-bordered min-w-0 flex-1 rounded-lg px-4 py-3 text-left disabled:opacity-50'
                >
                  <span className='block truncate text-sm font-medium'>{chapter.title}</span>
                  <span className='text-base-content/50 text-xs'>
                    {chapter.scannedSections && !chapter.text
                      ? `${chapter.scannedSections.length} scanned pages`
                      : `${Math.max(1, Math.round(chapter.text.length / 1800))} min`}
                  </span>
                </button>
                <button
                  type='button'
                  aria-label={`Ask AI about “${chapter.title}”`}
                  title='Ask AI about this chapter'
                  onClick={() => onAskAi(chapter)}
                  className='btn btn-ghost btn-circle shrink-0'
                >
                  <AiInsightsMark size={24} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default ChapterPicker;
