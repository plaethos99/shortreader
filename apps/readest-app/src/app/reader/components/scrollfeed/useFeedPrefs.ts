'use client';

/**
 * Narrator choice and speed for the feed's read-along, persisted across books.
 *
 * The voice is stored as an id rather than an index: Edge's voice list is
 * filtered per language, so an index means a different narrator from one book
 * to the next.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { EdgeSpeechTTS } from '@/libs/edgeTTS';
import {
  clampRate,
  defaultVoiceId,
  voicesForLang,
  type FeedVoice,
} from '@/services/scrollfeed/playback';
import { loadFeedPrefs, saveFeedPrefs } from '@/services/scrollfeed/store';

interface FeedPrefsState {
  voices: FeedVoice[];
  voiceId: string;
  rate: number;
  setVoiceId: (id: string) => void;
  setRate: (rate: number) => void;
}

export const useFeedPrefs = (lang: string): FeedPrefsState => {
  const voices = useMemo(() => voicesForLang(EdgeSpeechTTS.voices, lang), [lang]);
  const [stored, setStored] = useState('');
  const [rate, setRateState] = useState(1);

  useEffect(() => {
    let cancelled = false;
    void loadFeedPrefs().then((prefs) => {
      if (!prefs || cancelled) return;
      setStored(prefs.voiceId);
      setRateState(clampRate(prefs.rate));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A stored voice that isn't offered for this book's language — a French novel
  // after an English one — falls back to the first voice of the right language
  // rather than reading French prose in an English accent.
  const voiceId = voices.some((v) => v.id === stored) ? stored : defaultVoiceId(voices);

  const setVoiceId = useCallback(
    (id: string) => {
      setStored(id);
      void saveFeedPrefs({ voiceId: id, rate });
    },
    [rate],
  );

  const setRate = useCallback(
    (next: number) => {
      const clamped = clampRate(next);
      setRateState(clamped);
      void saveFeedPrefs({ voiceId, rate: clamped });
    },
    [voiceId],
  );

  return { voices, voiceId, rate, setVoiceId, setRate };
};
