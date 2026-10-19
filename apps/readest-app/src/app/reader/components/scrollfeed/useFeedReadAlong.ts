'use client';

/**
 * Hands-free read-along for the scroll feed.
 *
 * Speaks the active card, then advances to the next one, so the feed plays
 * itself — the point of the mode is to occupy the same reflex as scrolling a
 * video feed, which means it has to keep going without a tap per card.
 *
 * Built on EdgeSpeaker rather than the reader's EdgeTTSClient: that client is
 * bound to foliate's SSML/word-highlight pipeline and a section timeline, none
 * of which exists here. EdgeSpeaker is the same Edge TTS voice over a plain
 * <audio> element, and works on web, desktop and the Android WebView.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { EdgeSpeaker } from '@/services/tts/aiSpeaker';
import { spokenText } from '@/services/scrollfeed/playback';
import type { FeedCard } from '@/services/scrollfeed/types';

interface UseFeedReadAlongOptions {
  cards: FeedCard[];
  activeCard: number;
  // Called when a card finishes speaking and another one follows it.
  onAdvance: (next: number) => void;
  voiceId: string;
  lang: string;
  rate: number;
}

interface FeedReadAlong {
  playing: boolean;
  error: string;
  toggle: () => void;
}

export const useFeedReadAlong = ({
  cards,
  activeCard,
  onAdvance,
  voiceId,
  lang,
  rate,
}: UseFeedReadAlongOptions): FeedReadAlong => {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const speakerRef = useRef<EdgeSpeaker | null>(null);
  // Held in a ref so a new callback identity from the parent's render does not
  // restart playback of the card currently being spoken.
  const advanceRef = useRef(onAdvance);
  advanceRef.current = onAdvance;

  useEffect(() => {
    if (!playing) return;
    const card = cards[activeCard];
    if (!card) return;

    const speaker = (speakerRef.current ??= new EdgeSpeaker());
    let cancelled = false;

    void speaker
      .play(spokenText(card), voiceId, lang, rate)
      .then(() => {
        if (cancelled) return;
        const next = activeCard + 1;
        // Stop at the end of the chapter rather than looping or falling silent
        // while still showing a playing state.
        if (next < cards.length) advanceRef.current(next);
        else setPlaying(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Read-along failed');
        setPlaying(false);
      });

    return () => {
      cancelled = true;
      speaker.stop();
    };
    // Voice and rate are dependencies: changing either re-speaks the current
    // card in the new voice rather than waiting for the next one, so the
    // setting can be auditioned while listening.
  }, [playing, activeCard, cards, voiceId, lang, rate]);

  // Scrolling away, unmounting or leaving the chapter must not leave a voice
  // talking over whatever comes next.
  useEffect(() => () => speakerRef.current?.stop(), []);

  const toggle = useCallback(() => {
    setError('');
    setPlaying((on) => !on);
  }, []);

  return { playing, error, toggle };
};
