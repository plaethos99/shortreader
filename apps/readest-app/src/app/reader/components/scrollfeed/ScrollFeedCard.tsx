'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MdAutoAwesome } from 'react-icons/md';

import { generateBookVisual } from '@/services/luminaAI';
import { loadCardImage, saveCardImage } from '@/services/scrollfeed/store';
import { storySizeClass } from '@/services/scrollfeed/typography';
import MathText from '@/components/MathText';
import type { FeedCard } from '@/services/scrollfeed/types';
import type { TextMotion } from '@/services/scrollfeed/ambience';
import MotionText from '../ambience/MotionText';

interface ScrollFeedCardProps {
  card: FeedCard;
  bookHash: string;
  // True while this card is the one snapped into view. Drives the text
  // animation, which restarts each time the card becomes active.
  active: boolean;
  motion: TextMotion;
  // Long-press keeps the card in the reader's highlights.
  onLongPress: (card: FeedCard) => void;
}

const LONG_PRESS_MS = 550;
// A finger drifting further than this is a scroll, not a press.
const PRESS_SLOP_PX = 10;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const ScrollFeedCard: React.FC<ScrollFeedCardProps> = ({
  card,
  bookHash,
  active,
  motion,
  onLongPress,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // What the picture is waiting on: signing in to Flow / Imagine, or making it.
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const reduced = useRef(prefersReducedMotion());
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState(false);

  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const startPress = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, select')) return;
    endPress();
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        setPressed(true);
        setTimeout(() => setPressed(false), 1500);
        onLongPress(card);
      }, LONG_PRESS_MS),
    };
  };
  const movePress = (e: React.PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP_PX) endPress();
  };

  // A previously generated illustration is restored from IndexedDB, so the
  // button only ever spends a call once per card.
  useEffect(() => {
    let objectUrl = '';
    let cancelled = false;
    void loadCardImage(bookHash, card.id).then((blob) => {
      if (!blob || cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setImageUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bookHash, card.id]);

  const handleGenerate = async () => {
    if (generating || imageUrl) return;
    setGenerating(true);
    setStatus('');
    setError('');
    try {
      const dataUrl = await generateBookVisual(card.imagePrompt, '16:9', setStatus);
      const blob = await (await fetch(dataUrl)).blob();
      await saveCardImage(bookHash, card.id, blob);
      setImageUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Image generation failed');
    } finally {
      setGenerating(false);
      setStatus('');
    }
  };

  const bodyText = [card.story, ...card.points, card.example].join(' ');

  // The paragraph arrives as a whole: a per-word reveal, fine for a one-line
  // excerpt, keeps a 100-word paragraph half-invisible for seconds.
  const shown = active || reduced.current;
  const reveal = (delayMs: number): React.CSSProperties => ({
    opacity: shown ? 1 : 0,
    transform: shown ? 'none' : 'translateY(12px)',
    transition: reduced.current
      ? 'none'
      : `opacity 450ms ease-out ${delayMs}ms, transform 450ms ease-out ${delayMs}ms`,
  });

  return (
    <section
      // The top padding clears the feed's floating header: with plain vertical
      // centering a tall card's first line slid up behind it. Phone width wraps
      // the header onto two rows (way out, then player), hence the larger
      // value below `sm`. min-h-0 + overflow on the inner block means an
      // outsized card scrolls within itself rather than clipping under it.
      className='relative flex h-full w-full snap-start snap-always flex-col justify-center overflow-hidden px-6 pt-28 pb-12 sm:px-10 sm:pt-20'
      style={{ scrollSnapStop: 'always' }}
      onPointerDown={startPress}
      onPointerMove={movePress}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onContextMenu={(e) => e.preventDefault()}
    >
      {imageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt='' className='absolute inset-0 h-full w-full object-cover' />
          <div className='absolute inset-0 bg-black/60' />
        </>
      )}

      <div
        className={`relative mx-auto min-h-0 w-full max-w-xl overflow-y-auto transition-transform duration-300 ${
          imageUrl ? 'text-white' : ''
        } ${card.key ? 'border-primary/40 mt-4 rounded-2xl border p-5' : ''} ${
          pressed ? 'scale-[0.98]' : ''
        }`}
        style={
          card.key && active && !reduced.current
            ? { animation: 'feed-key-glow 1800ms ease-out 200ms both' }
            : undefined
        }
      >
        {card.key && (
          <p
            className={`mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${
              imageUrl ? 'text-white/80' : 'text-primary'
            }`}
            style={reveal(0)}
          >
            <MdAutoAwesome size={14} /> Key insight
          </p>
        )}
        {/* Concept / technique / idea cards open with what this card is. */}
        {card.title && (
          <header className='mb-4' style={reveal(0)}>
            {card.label && (
              <p
                className={`text-xs font-semibold uppercase tracking-[0.18em] ${
                  imageUrl ? 'text-white/70' : 'text-primary'
                }`}
              >
                {card.label}
              </p>
            )}
            <h3 className='mt-1 text-2xl font-semibold leading-tight sm:text-3xl'>
              <MathText text={card.title} />
            </h3>
          </header>
        )}

        {/* The paragraph is the card: a story card reads as book prose, the
            others as explanation. Sized by everything on the card so a card
            with points and an example still fits the screen. */}
        <p
          className={`${storySizeClass(bodyText)} leading-relaxed ${card.title ? '' : 'font-serif'}`}
          // The paragraph moves in the reader's chosen motion; the parts around
          // it simply fade up, so the eye has one thing to follow.
          style={{ transitionDelay: card.title ? '100ms' : '0ms' }}
        >
          <MotionText text={card.story} motion={motion} active={active} slow={card.key} />
        </p>

        {card.points.length > 0 && (
          <ul className='mt-4 list-disc space-y-1.5 pl-5 text-base sm:text-lg' style={reveal(200)}>
            {card.points.map((point) => (
              <li key={point}>
                <MathText text={point} />
              </li>
            ))}
          </ul>
        )}

        {card.example && (
          <pre
            className={`eink-bordered mt-4 overflow-x-auto rounded-lg p-3 text-sm leading-snug ${
              imageUrl ? 'bg-black/50' : 'bg-base-200'
            }`}
            style={reveal(250)}
          >
            <code>
              <MathText text={card.example} />
            </code>
          </pre>
        )}

        {/* The author's own words, when the model found a line worth it. */}
        {card.quote && (
          <blockquote
            className={`mt-6 border-l-2 pl-4 text-lg italic leading-snug sm:text-xl ${
              imageUrl ? 'border-white/60 text-white/90' : 'border-primary/60 text-base-content/85'
            }`}
            style={reveal(300)}
          >
            {card.quote}
          </blockquote>
        )}

        {!imageUrl && (
          <button
            type='button'
            onClick={handleGenerate}
            disabled={generating}
            className='btn btn-sm btn-ghost eink-bordered mt-8'
          >
            {generating ? 'Illustrating…' : 'Illustrate this'}
          </button>
        )}

        {generating && status && <p className='mt-3 text-xs opacity-70'>{status}</p>}
        {error && <p className='text-error mt-3 text-xs'>{error}</p>}
        {pressed && (
          <p className='text-primary mt-3 text-xs' role='status'>
            Saved to your highlights
          </p>
        )}
      </div>
    </section>
  );
};

export default ScrollFeedCard;
