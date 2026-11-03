import { describe, expect, test } from 'vitest';

import {
  checkRetelling,
  copiedShare,
  countWords,
  isSparse,
  normalizeCards,
  retellingCorrection,
  retoldText,
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
  // Sized for 5:2 condensation. Each card carries roughly 100 words, so a
  // 6000-word chapter needs ~24 cards to retain 40% of it. At 900 and then 300
  // words per card, readers felt they were missing the chapter; at 200 the book
  // itself came back.
  test('scales with chapter length at about one card per 250 words', () => {
    expect(targetCardCount('word '.repeat(6000))).toBe(24);
    expect(targetCardCount('word '.repeat(1700))).toBe(7);
  });

  test('gives a chapter in a script without spaces its full share', () => {
    expect(targetCardCount('爱'.repeat(12000))).toBe(24);
    expect(targetCardCount('อ'.repeat(24000))).toBe(24);
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
describe('countWords', () => {
  test('counts words split by spaces, ignoring stray punctuation', () => {
    expect(countWords('  The lamps — had not been lit.  ')).toBe(6);
    expect(countWords('   ')).toBe(0);
    expect(countWords('Алиса бежит за кроликом')).toBe(4);
  });

  // By spaces alone a Chinese chapter was one word and got one card.
  test('estimates words for scripts written without spaces', () => {
    expect(countWords('爱丽丝坐在河边想事情')).toBe(5);
    expect(countWords('アリスは川辺に')).toBe(4);
    expect(countWords('อลิซนั่งอยู่ริมแม่น้ำ')).toBe(5);
  });

  test('adds up a mix of scripts', () => {
    expect(countWords('Alice 爱丽丝坐')).toBe(3);
  });
});

// The opening of Alice's Adventures in Wonderland (public domain).
const ALICE = `Alice was beginning to get very tired of sitting by her sister on the
  bank, and of having nothing to do: once or twice she had peeped into the book
  her sister was reading, but it had no pictures or conversations in it, "and what
  is the use of a book," thought Alice "without pictures or conversations?" So she
  was considering in her own mind (as well as she could, for the hot day made her
  feel very sleepy and stupid), whether the pleasure of making a daisy-chain would
  be worth the trouble of getting up and picking the daisies, when suddenly a White
  Rabbit with pink eyes ran close by her.`;

describe('copiedShare', () => {
  test('a tight edit of the book is nearly all copied', () => {
    const edit = `Alice was beginning to get very tired of sitting by her sister on the
      bank: she had peeped into the book her sister was reading, but it had no pictures
      or conversations in it. So she was considering whether the pleasure of making a
      daisy-chain would be worth the trouble of getting up and picking the daisies, when
      suddenly a White Rabbit with pink eyes ran close by her.`;
    expect(copiedShare(edit, ALICE)).toBeGreaterThan(0.8);
  });

  test('a retelling with one line of the book in it is not', () => {
    const retelling = `Bored on the riverbank beside her sister, Alice glanced at the book in
      the older girl's hands and found it dull, all words. "And what is the use of a book,"
      she wondered, "without pictures or conversations?" The heat was making her drowsy,
      and she was idly weighing up a daisy-chain against the effort of standing, when a
      white rabbit with pink eyes dashed past.`;
    expect(copiedShare(retelling, ALICE)).toBeLessThan(0.25);
  });

  test('sees copying in scripts without spaces, ignoring case and punctuation', () => {
    expect(copiedShare('爱丽丝坐在河边，想事情。', '爱丽丝坐在河边想事情')).toBe(1);
    expect(copiedShare('ALICE WAS, BEGINNING TO GET VERY', ALICE)).toBe(1);
  });

  test('has nothing to count in an empty retelling', () => {
    expect(copiedShare('', ALICE)).toBe(0);
  });
});

describe('checkRetelling', () => {
  // 2000 words, in words the retellings below don't use.
  const source = 'chapter '.repeat(2000);
  const told = (words: number) => 'retold '.repeat(words);

  test('a retelling near the words asked for, in its own words, is fine', () => {
    expect(checkRetelling(told(800), source, 800)).toEqual({ words: 800, problem: null, miss: 0 });
    expect(checkRetelling(told(560), source, 800).problem).toBeNull();
    expect(checkRetelling(told(1040), source, 800).problem).toBeNull();
  });

  test('under 70% of the words asked for is too short', () => {
    expect(checkRetelling(told(559), source, 800).problem).toBe('short');
  });

  // A translated book shares no words with its source: only its length shows it.
  test('over 130% of the words asked for is too long', () => {
    expect(checkRetelling(told(1041), source, 800).problem).toBe('long');
  });

  test('a retelling lifted from the source is copied, at any length', () => {
    expect(checkRetelling('chapter '.repeat(800), source, 800).problem).toBe('copied');
  });

  test('a closer attempt misses by less', () => {
    const far = checkRetelling(told(100), source, 800);
    const near = checkRetelling(told(500), source, 800);
    expect(near.miss).toBeLessThan(far.miss);
  });

  // An epigraph retold word for word is fine, and not worth paying for twice.
  test('leaves a very short source alone', () => {
    expect(checkRetelling(ALICE, ALICE, 50)).toMatchObject({ problem: null, miss: 0 });
  });
});

describe('retellingCorrection', () => {
  test('says what was wrong with the reply', () => {
    const check = (problem: 'short' | 'long' | 'copied', words: number) =>
      retellingCorrection({ words, problem, miss: 1 }, 800, 'answer');
    expect(check('short', 12)).toMatch(/previous answer was only about 12 words/);
    expect(check('short', 12)).toMatch(/full 800 words/);
    expect(check('copied', 800)).toMatch(/copied long stretches/);
    expect(check('long', 1500)).toMatch(/ran to about 1500 words/);
  });

  test('has nothing to say about a good reply or an empty one', () => {
    expect(retellingCorrection({ words: 800, problem: null, miss: 0 }, 800, 'script')).toBe('');
    expect(retellingCorrection({ words: 0, problem: 'short', miss: 1 }, 800, 'script')).toBe('');
  });
});

describe('retoldText', () => {
  test('joins the story and points of each card', () => {
    expect(
      retoldText([
        { story: 'one two', points: ['three'] },
        { story: 'four', points: [] },
      ]),
    ).toBe('one two three four');
  });
});

describe('isSparse', () => {
  const chapter = 'word '.repeat(3300); // target 13

  test('a chapter that yielded under half its target cards is sparse', () => {
    expect(isSparse(0, chapter)).toBe(true);
    expect(isSparse(1, chapter)).toBe(true);
    expect(isSparse(6, chapter)).toBe(true);
  });

  test('a chapter at or above half its target is usable', () => {
    expect(isSparse(7, chapter)).toBe(false);
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
