import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

const speaker = vi.hoisted(() => ({
  play: vi.fn(() => new Promise<void>(() => {})),
  prefetch: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('@/services/tts/aiSpeaker', () => ({
  EdgeSpeaker: class {
    play = speaker.play;
    prefetch = speaker.prefetch;
    stop = speaker.stop;
  },
}));

import { act } from 'react';
import { useFeedReadAlong } from '@/app/reader/components/scrollfeed/useFeedReadAlong';
import type { FeedCard } from '@/services/scrollfeed/types';

const card = (n: number) =>
  ({ id: `c${n}`, title: '', story: `Card ${n}.`, points: [], quote: '' }) as unknown as FeedCard;

describe('feed read-along', () => {
  // Fetching each card's voice only when it became active left a silent
  // network round trip after every scroll.
  test('fetches the next two cards’ voice while one plays', () => {
    const cards = [card(0), card(1), card(2), card(3)];
    const { result, rerender } = renderHook(
      ({ active }) =>
        useFeedReadAlong({
          cards,
          activeCard: active,
          onAdvance: () => {},
          voiceId: 'v',
          lang: 'en',
          rate: 1,
        }),
      { initialProps: { active: 0 } },
    );
    act(() => result.current.toggle());

    expect(speaker.play).toHaveBeenLastCalledWith('Card 0.', 'v', 'en', 1);
    expect(speaker.prefetch.mock.calls.map((c) => c[0])).toEqual(['Card 1.', 'Card 2.']);

    speaker.prefetch.mockClear();
    rerender({ active: 2 });
    expect(speaker.play).toHaveBeenLastCalledWith('Card 2.', 'v', 'en', 1);
    // Only one card left after this one.
    expect(speaker.prefetch.mock.calls.map((c) => c[0])).toEqual(['Card 3.']);
  });
});
