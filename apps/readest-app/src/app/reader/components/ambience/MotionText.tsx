'use client';

/**
 * Card text that arrives in the reader's chosen motion when its card becomes
 * active, and replays when the card is scrolled back into view.
 *
 * - rise: the paragraph fades up as one.
 * - cascade: sentence by sentence, like breaths.
 * - bloom: words sharpen out of a blur in a quick ripple.
 * - ink: written in by a soft edge moving down the text.
 * - spot: one sentence at a time glows at reading pace; what it passed stays
 *   readable, what is ahead is dimmed, and the whole paragraph settles to full
 *   brightness at the end. Tapping a sentence moves the light there — a
 *   reader who fell behind goes back instead of losing the text.
 *
 * A key card moves a little slower: the pause is part of the reward.
 */
import React, { useEffect, useMemo, useState } from 'react';

import MathText from '@/components/MathText';
import { splitSentences, splitWords, type TextMotion } from '@/services/scrollfeed/ambience';
import { prefersReducedMotion } from './AmbientBackground';

interface MotionTextProps {
  text: string;
  motion: TextMotion;
  active: boolean;
  slow?: boolean;
}

// The whole word ripple fits in this, however long the paragraph.
const BLOOM_SPAN_MS = 1600;
// Slow enough for a second language; every sentence gets its moment.
const WORDS_PER_MINUTE = 200;
const MIN_SENTENCE_MS = 2000;
const MAX_SENTENCE_MS = 8000;
const PASSED_OPACITY = 0.8;
const AHEAD_OPACITY = 0.35;

const animation = (name: string, ms: number, delay: number): React.CSSProperties => ({
  animation: `${name} ${ms}ms cubic-bezier(.2,.7,.2,1) ${delay}ms both`,
});

const MotionText: React.FC<MotionTextProps> = ({ text, motion, active, slow = false }) => {
  const [lit, setLit] = useState(-1);
  // Where the spotlight walk starts; a new object restarts it, even at the
  // same sentence.
  const [start, setStart] = useState({ at: 0 });
  const pace = slow ? 1.4 : 1;
  const still = useMemo(() => prefersReducedMotion(), []);
  const sentences = useMemo(() => splitSentences(text), [text]);
  const words = useMemo(() => splitWords(text), [text]);

  // Spotlight: step through the sentences at reading pace, once.
  useEffect(() => {
    if (motion !== 'spot' || !active || still) {
      setLit(-1);
      return;
    }
    let i = start.at;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      setLit(i);
      if (i >= sentences.length) return;
      const count = sentences[i]!.split(/\s+/).length;
      const reading = (count / WORDS_PER_MINUTE) * 60000;
      const ms = Math.min(MAX_SENTENCE_MS, Math.max(MIN_SENTENCE_MS, reading)) * pace;
      i++;
      timer = setTimeout(step, ms);
    };
    step();
    return () => clearTimeout(timer);
  }, [motion, active, still, sentences, pace, start]);

  // A new chapter card starts its walk from the top.
  useEffect(() => {
    if (!active) setStart({ at: 0 });
  }, [active]);

  if (still) return <MathText text={text} />;

  // Off screen: laid out, unseen, ready to play again.
  if (!active) {
    return (
      <span style={{ opacity: motion === 'spot' ? AHEAD_OPACITY : 0 }}>
        <MathText text={text} />
      </span>
    );
  }

  if (motion === 'cascade') {
    return (
      <>
        {sentences.map((s, i) => (
          <span key={i} style={animation('feed-soft', 900 * pace, i * 650 * pace)}>
            <MathText text={s} />{' '}
          </span>
        ))}
      </>
    );
  }

  if (motion === 'bloom') {
    const step = Math.min(24, BLOOM_SPAN_MS / Math.max(1, words.length)) * pace;
    return (
      <>
        {words.map((w, i) =>
          w.trim() ? (
            <span
              key={i}
              className='inline-block'
              style={animation('feed-bloom', 550 * pace, i * step)}
            >
              <MathText text={w} />
            </span>
          ) : (
            w
          ),
        )}
      </>
    );
  }

  if (motion === 'ink') {
    return (
      <span className='feed-ink' style={animation('feed-ink', 2600 * pace, 0)}>
        <MathText text={text} />
      </span>
    );
  }

  if (motion === 'spot') {
    const done = lit >= sentences.length;
    return (
      <>
        {sentences.map((s, i) => (
          <span
            key={i}
            data-sentence
            onClick={() => setStart({ at: i })}
            className='cursor-pointer transition-[opacity,text-shadow] duration-700 ease-out'
            style={{
              opacity: done || i === lit ? 1 : i < lit ? PASSED_OPACITY : AHEAD_OPACITY,
              textShadow:
                i === lit && !done
                  ? '0 0 18px color-mix(in srgb, currentColor 35%, transparent)'
                  : 'none',
            }}
          >
            <MathText text={s} />{' '}
          </span>
        ))}
      </>
    );
  }

  return (
    <span className='inline-block' style={animation('feed-rise', 600 * pace, 0)}>
      <MathText text={text} />
    </span>
  );
};

export default MotionText;
