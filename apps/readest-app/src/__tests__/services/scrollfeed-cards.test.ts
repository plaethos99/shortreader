import { describe, expect, test } from 'vitest';

import {
  isSparse,
  normalizeCards,
  targetCardCount,
  withCardDefaults,
} from '@/services/scrollfeed/cards';

const chapterText = `
  The lamps along the quay had not yet been lit. Marlow sat cross-legged
  against the mizzen-mast, and the sea reached out flat and grey to the edge
  of the world. "And this also," said Marlow suddenly, "has been one of the
  dark places of the earth."   He said it without raising his voice.
`;

describe('targetCardCount', () => {
  // Sized for ~3:1 condensation, the "30 pages explained in 10" target. Each
  // card carries roughly 100 words (a short beat plus a 3-6 sentence quote), so
  // a 30-page chapter (~9000 words) needs ~30 cards to retain a third of it.
  // An earlier 900-words-per-card setting produced 4 cards for a 1700-word
  // chapter — about 10:1, which read as highlights rather than a condensation.
  test('scales with chapter length at about one card per 300 words', () => {
    expect(targetCardCount('word '.repeat(9000))).toBe(30);
    expect(targetCardCount('word '.repeat(1700))).toBe(6);
  });

  // Three cards minimum made a 150-word page into ~120 words of cards: not a
  // retelling but a near-copy, padded with invented detail. Short text gets
  // fewer cards; huge chapters stay finite.
  test('scales down to a single card for short text and stays finite for huge ones', () => {
    expect(targetCardCount('word '.repeat(50))).toBe(1);
    expect(targetCardCount('word '.repeat(150))).toBe(1);
    expect(targetCardCount('word '.repeat(600))).toBe(2);
    expect(targetCardCount('word '.repeat(500000))).toBe(40);
  });

  test('an empty chapter asks for nothing', () => {
    expect(targetCardCount('   ')).toBe(0);
  });
});

// A truncated or malformed model response, or a pre-fix PDF chapter whose
// quotes never matched, yields 0-1 cards for a chapter that should have ~11.
// Such a result must not be cached as the chapter's feed forever.
describe('isSparse', () => {
  const chapter = 'word '.repeat(3300); // target 11

  test('a chapter that yielded under half its target cards is sparse', () => {
    expect(isSparse(0, chapter)).toBe(true);
    expect(isSparse(1, chapter)).toBe(true);
    expect(isSparse(5, chapter)).toBe(true);
  });

  test('a chapter at or above half its target is usable', () => {
    expect(isSparse(6, chapter)).toBe(false);
    expect(isSparse(11, chapter)).toBe(false);
  });

  test('an empty chapter is never sparse — there was nothing to condense', () => {
    expect(isSparse(0, '   ')).toBe(false);
  });
});

// Story feeds cached before cards gained label/title/points/example have no
// such fields; rendering `...card.points` on one crashed the feed
// ("card.points is not iterable") on reopening the book.
describe('withCardDefaults', () => {
  test('fills fields missing from a feed cached before they existed', () => {
    const cached = {
      format: 2,
      chapterIdx: 3,
      title: 'Ch',
      cards: [{ id: '3-0', chapterIdx: 3, story: 's', quote: '', imagePrompt: 'p' }],
    };

    const feed = withCardDefaults(cached as never);

    expect(feed.cards[0]).toEqual({
      id: '3-0',
      chapterIdx: 3,
      story: 's',
      quote: '',
      imagePrompt: 'p',
      label: '',
      title: '',
      points: [],
      example: '',
    });
  });

  test('leaves complete cards as they are', () => {
    const card = {
      id: '0-0',
      chapterIdx: 0,
      label: 'Concept',
      title: 'T',
      points: ['a'],
      example: 'x',
      story: 's',
      quote: 'q',
      imagePrompt: 'p',
    };

    expect(withCardDefaults({ chapterIdx: 0, title: 'c', cards: [card] }).cards[0]).toEqual(card);
  });
});

describe('normalizeCards', () => {
  const raw = [
    {
      story: 'Dusk settles on the Thames and Marlow, cross-legged by the mast, begins.',
      quote: 'has been one of the dark places of the earth.',
      imagePrompt: 'A grey estuary at dusk, lamps unlit',
    },
  ];

  test('keeps the retelling and a verified line from the author', () => {
    const cards = normalizeCards(raw, 3, chapterText);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe('3-0');
    expect(cards[0]!.chapterIdx).toBe(3);
    expect(cards[0]!.story).toBe(raw[0]!.story);
    expect(cards[0]!.quote).toBe('has been one of the dark places of the earth.');
  });

  test('matches quotes across curly/straight quote differences', () => {
    const curly = 'The lamps along the quay had not yet been lit. “And this also,” he said.';
    const cards = normalizeCards([{ ...raw[0]!, quote: '"And this also," he said.' }], 0, curly);

    expect(cards[0]!.quote).toBe('"And this also," he said.');
  });

  // The retelling carries the chapter; the quote is garnish. A paraphrased or
  // stitched quote must never be shown as the author's words — but dropping
  // the whole card for it would punch a hole in the story.
  test('drops an unverifiable quote but keeps the card', () => {
    const cards = normalizeCards(
      [
        { ...raw[0]!, quote: 'This too was once a dark corner of the world.' },
        { ...raw[0]!, quote: 'And this also has been one of the dark places of the earth.' },
      ],
      0,
      chapterText,
    );

    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.quote)).toEqual(['', '']);
  });

  test('a card with no quote is a normal card', () => {
    const cards = normalizeCards([{ ...raw[0]!, quote: '' }], 0, chapterText);

    expect(cards).toHaveLength(1);
    expect(cards[0]!.quote).toBe('');
  });

  test('drops cards with no retelling', () => {
    const cards = normalizeCards(
      [{ story: '  ', quote: 'He said it without raising his voice.', imagePrompt: 'x' }],
      0,
      chapterText,
    );

    expect(cards).toEqual([]);
  });

  test('tolerates fields that are missing or not strings', () => {
    const cards = normalizeCards(
      [{ story: 'Marlow speaks.', quote: 42, imagePrompt: null } as never],
      0,
      chapterText,
    );

    expect(cards[0]!.quote).toBe('');
    expect(cards[0]!.imagePrompt).toBe('Marlow speaks.');
  });

  // Concept / technique cards carry a heading, a few points and maybe an
  // example; a story card leaves them empty.
  test('keeps label, title, points and example, trimmed and bounded', () => {
    const cards = normalizeCards(
      [
        {
          story: 'Replication keeps a copy of the same data on several machines.',
          quote: '',
          imagePrompt: 'p',
          label: ' Concept ',
          title: ' Replication ',
          points: ['Leaders take writes', '  ', 7, 'Followers apply the log', 'c', 'd', 'e'],
          example: '  SELECT * FROM t;  ',
        } as never,
      ],
      0,
      chapterText,
    );

    expect(cards[0]).toMatchObject({
      label: 'Concept',
      title: 'Replication',
      points: ['Leaders take writes', 'Followers apply the log', 'c', 'd'],
      example: 'SELECT * FROM t;',
    });
  });

  test('a story card gets empty extras', () => {
    const cards = normalizeCards([raw[0]!], 0, chapterText);

    expect(cards[0]).toMatchObject({ label: '', title: '', points: [], example: '' });
  });

  test('ids stay sequential over the cards that survive', () => {
    const cards = normalizeCards(
      [
        { story: 'One.', quote: '', imagePrompt: 'a' },
        { story: '', quote: '', imagePrompt: 'b' },
        { story: 'Three.', quote: '', imagePrompt: 'c' },
      ],
      7,
      chapterText,
    );

    expect(cards.map((c) => c.id)).toEqual(['7-0', '7-1']);
  });
});
