import { describe, expect, test } from 'vitest';

import { renumberCards, segmentChapter } from '@/services/scrollfeed/segments';
import type { FeedCard } from '@/services/scrollfeed/types';

const sentences = (count: number, wordsEach = 10): string =>
  Array.from({ length: count }, (_, i) => `${`s${i} `.repeat(wordsEach).trim()}.`).join(' ');

describe('segmentChapter', () => {
  // The generator used to hand the model `text.slice(0, 80000)`. Anything past
  // that was dropped with no trace, so a long chapter silently lost its ending —
  // the exact failure the "curate without losing important bits" requirement
  // rules out. Segmenting covers the whole chapter instead.
  test('a chapter within the budget is one segment, unchanged', () => {
    const text = sentences(5);

    expect(segmentChapter(text, 80000)).toEqual([text]);
  });

  test('a long chapter is covered end to end, not truncated', () => {
    const text = sentences(400);
    const segments = segmentChapter(text, 500);

    expect(segments.length).toBeGreaterThan(1);
    // Every segment's words reappear in order: nothing was dropped.
    expect(segments.join(' ')).toBe(text);
  });

  test('no segment exceeds the budget', () => {
    const segments = segmentChapter(sentences(400), 500);

    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(500);
    }
  });

  // Cutting mid-sentence would hand the model a fragment whose quotes then fail
  // verification against the segment, silently costing cards at every boundary.
  test('splits on sentence boundaries, never mid-sentence', () => {
    const segments = segmentChapter(sentences(50), 400);

    for (const segment of segments.slice(0, -1)) {
      expect(segment.trimEnd().endsWith('.')).toBe(true);
    }
  });

  // A 100k-character sentence is pathological but must terminate rather than
  // spin forever trying to find a boundary that isn't there.
  test('hard-splits a single sentence longer than the budget', () => {
    const segments = segmentChapter('x'.repeat(1200), 500);

    expect(segments.length).toBe(3);
    expect(segments.join('')).toBe('x'.repeat(1200));
  });

  test('an empty chapter yields no segments', () => {
    expect(segmentChapter('   ', 500)).toEqual([]);
  });
});

describe('renumberCards', () => {
  const card = (id: string, story: string): FeedCard => ({
    id,
    chapterIdx: 4,
    label: '',
    title: '',
    points: [],
    example: '',
    story,
    quote: 'q',
    imagePrompt: 'p',
  });

  // Cards come back per segment, each numbered from 0 by normalizeCards. Left
  // alone they collide — two cards with id "4-0" break the React keys and make
  // the second segment's illustrations overwrite the first's in IndexedDB,
  // which is keyed by card id.
  test('gives cards from separate segments unique sequential ids', () => {
    const merged = renumberCards([card('4-0', 'a'), card('4-1', 'b')], [card('4-0', 'c')]);

    expect(merged.map((c) => c.id)).toEqual(['4-0', '4-1', '4-2']);
  });

  test('preserves card order and content across segments', () => {
    const merged = renumberCards([card('4-0', 'first')], [card('4-0', 'second')]);

    expect(merged.map((c) => c.story)).toEqual(['first', 'second']);
    expect(merged[1]!.chapterIdx).toBe(4);
  });

  test('handles a segment that produced nothing', () => {
    const merged = renumberCards([], [card('4-0', 'only')]);

    expect(merged.map((c) => c.id)).toEqual(['4-0']);
  });
});
