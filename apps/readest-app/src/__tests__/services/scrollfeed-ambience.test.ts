import { describe, expect, test } from 'vitest';

import {
  BACKDROPS,
  blendPalette,
  dominantColors,
  FEED_MOODS,
  moodPalette,
  splitSentences,
  splitWords,
  TEXT_MOTIONS,
  toMood,
} from '@/services/scrollfeed/ambience';

describe('choices', () => {
  test('offers the five text motions and the backgrounds, plain first for e-ink', () => {
    expect(TEXT_MOTIONS.map((m) => m.id)).toEqual(['rise', 'cascade', 'bloom', 'ink', 'spot']);
    expect(BACKDROPS.map((b) => b.id)).toEqual([
      'plain',
      'aurora',
      'breathe',
      'grain',
      'motes',
      'waves',
      'focus',
    ]);
  });

  test('every mood has a three-colour palette of hex colours', () => {
    for (const mood of FEED_MOODS) {
      const palette = moodPalette(mood.id);
      expect(palette).toHaveLength(3);
      for (const c of palette) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test('an unknown mood reads as calm rather than failing', () => {
    expect(toMood('cyberpunk')).toBe('calm');
    expect(toMood('fantasy')).toBe('fantasy');
    expect(moodPalette('nope' as never)).toEqual(moodPalette('calm'));
  });
});

describe('blendPalette', () => {
  test('pulls each colour part of the way toward the matching cover colour', () => {
    expect(blendPalette(['#000000', '#000000', '#000000'], ['#ffffff'], 0.5)).toEqual([
      '#808080',
      '#000000',
      '#000000',
    ]);
  });

  test('no cover colours leaves the palette as it is', () => {
    expect(blendPalette(['#123456', '#abcdef', '#000000'], [])).toEqual([
      '#123456',
      '#abcdef',
      '#000000',
    ]);
  });
});

describe('dominantColors', () => {
  const pixels = (colors: [number, number, number, number][]) =>
    new Uint8ClampedArray(colors.flatMap((c) => c));

  test('returns the most common saturated colours, most common first', () => {
    const data = pixels([
      ...Array(50).fill([200, 30, 30, 255]),
      ...Array(30).fill([30, 60, 200, 255]),
      ...Array(80).fill([250, 250, 250, 255]), // white margin: ignored
      ...Array(80).fill([10, 10, 10, 255]), // black: ignored
      ...Array(40).fill([120, 120, 120, 255]), // grey: ignored
    ]);

    const colors = dominantColors(data, 3);

    expect(colors).toHaveLength(2);
    expect(colors[0]).toMatch(/^#c/); // the red first
  });

  test('a colourless cover yields nothing', () => {
    expect(dominantColors(pixels(Array(20).fill([128, 128, 128, 255])), 3)).toEqual([]);
  });
});

describe('splitSentences', () => {
  test('splits prose at sentence ends, keeping the punctuation', () => {
    expect(splitSentences('Tom waits. The sea is calm! Is it? Yes.')).toEqual([
      'Tom waits.',
      'The sea is calm!',
      'Is it?',
      'Yes.',
    ]);
  });

  test('never splits inside math', () => {
    expect(splitSentences('The speed is $v = 3.5 m/s. x$ here. Next one.')).toEqual([
      'The speed is $v = 3.5 m/s. x$ here.',
      'Next one.',
    ]);
  });

  test('handles CJK and Devanagari full stops', () => {
    expect(splitSentences('海は静かだ。トムは待つ。')).toEqual(['海は静かだ。', 'トムは待つ。']);
    expect(splitSentences('समुद्र शांत है। टॉम इंतज़ार करता है।')).toEqual([
      'समुद्र शांत है।',
      'टॉम इंतज़ार करता है।',
    ]);
  });
});

describe('splitWords', () => {
  test('keeps the spaces so the words join back exactly', () => {
    const words = splitWords('Tom  waits by the sea.');
    expect(words.join('')).toBe('Tom  waits by the sea.');
    expect(words.filter((w) => w.trim())).toEqual(['Tom', 'waits', 'by', 'the', 'sea.']);
  });

  test('math is kept whole as one piece', () => {
    expect(splitWords('so $a + b$ holds')).toEqual(['so', ' ', '$a + b$', ' ', 'holds']);
  });
});
