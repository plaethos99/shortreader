import { beforeEach, describe, expect, test, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

// chatJson parses the reply text, so the mock resolves to what the model sent.
vi.mock('@/services/llm', () => ({
  chatJson: async (prompt: string, options?: { maxTokens?: number }) => {
    const { text } = await generateContent(prompt, options);
    return JSON.parse(text);
  },
}));

import { generateChapterFeed } from '@/services/scrollfeed/generate';
import { FEED_FORMAT } from '@/services/scrollfeed/types';

// ~1800 words -> target 7 cards, about 700 words.
const chapter = `Sentence number 0 is here. ${'filler '.repeat(1800)}`;

// Cards of about 100 words, so six of them reach the chapter's length.
const reply = (count: number) => ({
  text: JSON.stringify({
    cards: Array.from({ length: count }, (_, i) => ({
      story: `Part ${i} of the retelling. ${'word '.repeat(100).trim()}`,
      quote: '',
      imagePrompt: 'p',
    })),
  }),
});

const shortReply = (count: number) => ({
  text: JSON.stringify({
    cards: Array.from({ length: count }, (_, i) => ({
      story: `Part ${i}.`,
      quote: '',
      imagePrompt: 'p',
    })),
  }),
});

const promptOf = (call: number): string => generateContent.mock.calls[call]![0];

// Answers each prompt with as many words as it asks for.
const fitReply = (prompt: string) =>
  Promise.resolve(
    reply(Math.round(Number(prompt.match(/about (\d+) words in\s+total/)![1]) / 100)),
  );

describe('generateChapterFeed', () => {
  beforeEach(() => {
    generateContent.mockReset();
  });

  test('asks for a retelling that covers the whole chapter, about 40% of its length', async () => {
    generateContent.mockResolvedValueOnce(reply(6));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(feed.format).toBe(FEED_FORMAT);
    expect(feed.cards[5]!.story).toContain('Part 5 of the retelling.');
    const prompt = promptOf(0);
    expect(prompt).toContain('7 cards');
    expect(prompt).toMatch(/about 700 words/);
    expect(prompt).toMatch(/about 100 words, never\s+more than 130/);
    expect(prompt).toContain('"story"');
  });

  // Told to read like the book told more tightly, in its own voice and with its
  // dialogue played out, models handed the book back. Told to trim description
  // and write in the third person, the retelling had lost what made it matter.
  test("asks for the whole chapter in the model's own sentences", async () => {
    generateContent.mockResolvedValueOnce(reply(6));

    await generateChapterFeed(2, 'Two', chapter, 'Book');

    const prompt = promptOf(0);
    expect(prompt).toMatch(/in your own sentences/);
    expect(prompt).toMatch(/Never copy them, lightly edit them or\s+translate them one by one/);
    expect(prompt).toMatch(/stays in the first\s+person/);
    expect(prompt).toMatch(/never drop a scene, a motive or\s+a thought/);
    expect(prompt).toMatch(/neither a summary of it nor the book itself/);
    expect(prompt).not.toMatch(/book itself told more tightly/);
    expect(prompt).not.toMatch(/Trim repetition and\s+description/);
  });

  // Six 40-word cards pass as six cards. A concise model has to be told, or it
  // answers the same way twice.
  test('asks again, saying so, when the cards are far too short', async () => {
    generateContent.mockResolvedValueOnce(shortReply(6)).mockResolvedValueOnce(reply(7));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(promptOf(0)).not.toMatch(/previous answer was only/);
    expect(promptOf(1)).toMatch(/previous answer was only about 12 words/);
    expect(promptOf(1)).toMatch(/full 700 words/);
    expect(feed.cards).toHaveLength(7);
  });

  test('keeps the longer answer when asking again gets a shorter one', async () => {
    generateContent.mockResolvedValueOnce(shortReply(6)).mockResolvedValueOnce(shortReply(5));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(feed.cards).toHaveLength(6);
  });

  // A translated chapter shares no words with its source, so its length is
  // what gives it away.
  test('asks again, saying so, when the answer is about as long as the chapter', async () => {
    generateContent.mockResolvedValueOnce(reply(17)).mockResolvedValueOnce(reply(7));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(promptOf(1)).toMatch(/previous answer ran to about \d+ words/);
    expect(feed.cards).toHaveLength(7);
  });

  test('asks again, saying so, when the answer copies the chapter', async () => {
    const sentences = Array.from({ length: 800 }, (_, i) => `Sentence ${i} of the book.`);
    const book = sentences.join(' ');
    const copy = (story: string) => ({
      text: JSON.stringify({ cards: [{ story, quote: '', imagePrompt: 'p' }] }),
    });
    generateContent
      .mockResolvedValueOnce(copy(sentences.slice(0, 320).join(' ')))
      .mockResolvedValueOnce(copy('Told anew. '.repeat(800)));

    const feed = await generateChapterFeed(2, 'Two', book, 'Book');

    expect(promptOf(0)).not.toMatch(/copied long stretches/);
    expect(promptOf(1)).toMatch(/previous answer copied long stretches/);
    expect(feed.cards[0]!.story).toContain('Told anew.');
  });

  // A quote is the one place the book's own words belong.
  test('does not count a quote as copying', async () => {
    const book = Array.from({ length: 800 }, (_, i) => `Sentence ${i} of the book.`).join(' ');
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        cards: Array.from({ length: 16 }, () => ({
          story: 'Told anew. '.repeat(50),
          quote: 'Sentence 1 of the book. Sentence 2 of the book.',
          imagePrompt: 'p',
        })),
      }),
    });

    const feed = await generateChapterFeed(2, 'Two', book, 'Book');

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(feed.cards[0]!.quote).toBe('Sentence 1 of the book. Sentence 2 of the book.');
  });

  test('keeps the cards in hand when asking again fails', async () => {
    generateContent
      .mockResolvedValueOnce(reply(17))
      .mockRejectedValueOnce(new Error('OpenRouter 429: rate limited'));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(feed.cards).toHaveLength(17);
  });

  test('a chapter in a script without spaces gets its full share', async () => {
    generateContent.mockImplementation(fitReply);

    await generateChapterFeed(2, 'Two', `${'爱丽丝坐在河边。'.repeat(1000)}`, 'Book');

    // 7000 characters, about 3500 words, so 14 cards and 1400 words.
    expect(promptOf(0)).toContain('14 cards');
    expect(promptOf(0)).toMatch(/about 1400 words/);
  });

  // The card's substance follows the book: concepts for a technical book,
  // techniques for self-help, arguments and events for other non-fiction.
  test.each([
    ['concepts', /core concept/i],
    ['techniques', /technique/i],
    ['ideas', /key idea/i],
  ] as const)('a %s feed asks for that kind of card and records its style', async (style, re) => {
    generateContent.mockResolvedValueOnce(reply(6));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book', style);

    expect(feed.style).toBe(style);
    const prompt = promptOf(0);
    expect(prompt).toMatch(re);
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"points"');
    expect(prompt).not.toMatch(/stays in the first/);
  });

  // The story prompt asks for bare narrative; a one-card chapter came back
  // with a label, a title and bullet points repeating the paragraph anyway.
  test('story cards are bare narrative even when the model adds headings and points', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        cards: [
          {
            label: 'THE OLD HARBOUR',
            title: 'Waiting',
            points: ['a'],
            example: 'x',
            story: 'Tom waits.',
            quote: '',
            imagePrompt: 'p',
          },
        ],
      }),
    });

    const feed = await generateChapterFeed(2, 'Two', 'word '.repeat(200), 'Book');

    expect(feed.cards[0]).toMatchObject({
      label: '',
      title: '',
      points: [],
      example: '',
      story: 'Tom waits.',
    });
  });

  test('a story feed is the default and keeps the narrative retelling', async () => {
    generateContent.mockResolvedValueOnce(reply(6));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(feed.style).toBe('story');
    expect(promptOf(0)).toMatch(/flowing narrative prose/);
  });

  // The cards are written in the chosen language rather than translated
  // afterwards, so it costs one call either way. The quote is the exception:
  // it is verified against the chapter, so a translated one would be a fake.
  test('asks for the cards in the chosen language and records it on the feed', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        cards: Array.from({ length: 6 }, () => ({
          story: 'ఆలిస్ తెల్ల కుందేలును వెంబడిస్తుంది.',
          quote: '',
          imagePrompt: 'p',
        })),
      }),
    });

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book', 'story', 'te');

    expect(feed.language).toBe('te');
    const prompt = promptOf(0);
    expect(prompt).toContain('Telugu');
    expect(prompt).toContain('తెలుగు');
    expect(prompt).toMatch(/never translate it|exactly as it appears/i);
  });

  // English must be named too: left unsaid, a Russian book came back in
  // Russian while the picker said English.
  test('English is the default and is asked for explicitly', async () => {
    generateContent.mockResolvedValueOnce(reply(6));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(feed.language).toBe('en');
    const prompt = promptOf(0);
    expect(prompt).toMatch(/"story", "points", "example" and "teaser" in English/);
    expect(prompt).not.toContain('Telugu');
  });

  // Asked for ~30 cards in one reply, DeepSeek ignored the word budget and a
  // Russian chapter came back longer than the original. Segments stay small.
  test('splits a 30k-character chapter rather than retelling it in one call', async () => {
    // Always the length asked for, so every call is a segment, not a retry.
    generateContent.mockImplementation(fitReply);

    await generateChapterFeed(2, 'Two', 'A sentence of the chapter. '.repeat(1100), 'Book');

    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  // A 79k-char Russian chapter needs more than DeepSeek's default 8192 output
  // tokens; cut off mid-JSON, both attempts parsed to 0 cards.
  test('lets a reply run past the default output cap', async () => {
    generateContent.mockResolvedValueOnce(reply(6));

    await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(generateContent.mock.calls[0]![1]?.maxTokens).toBeGreaterThanOrEqual(32768);
  });

  // The cards render LaTeX between $...$; the model must use that notation and
  // double its backslashes, or JSON decodes "\frac" as a form feed + "rac".
  test('asks for equations as $...$ LaTeX with escaped backslashes', async () => {
    generateContent.mockResolvedValueOnce(reply(6));

    await generateChapterFeed(2, 'Two', chapter, 'Book', 'concepts');

    const prompt = promptOf(0);
    expect(prompt).toContain('$...$');
    expect(prompt).toContain('\\\\frac');
  });

  // The chapter's biggest moment gets a reveal of its own, and the last card
  // leaves a hook for the next chapter.
  test('asks for key-insight cards and a teaser, and keeps them', async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        cards: [
          { story: 'A.', quote: '', imagePrompt: 'p', key: false },
          { story: 'B.', quote: '', imagePrompt: 'p', key: true },
          { story: 'C.', quote: '', imagePrompt: 'p', key: 'yes' },
        ],
        teaser: '  But who left the door open?  ',
      }),
    });

    const feed = await generateChapterFeed(2, 'Two', 'word '.repeat(900), 'Book');

    const prompt = promptOf(0);
    expect(prompt).toContain('"key"');
    expect(prompt).toContain('"teaser"');
    expect(feed.cards.map((c) => c.key)).toEqual([false, true, false]);
    expect(feed.teaser).toBe('But who left the door open?');
  });

  test("a long chapter's teaser comes from its last segment", async () => {
    const teaserReply = (t: string) => ({
      text: JSON.stringify({
        cards: Array.from({ length: 14 }, (_, i) => ({
          story: `S${i} ${'word '.repeat(100).trim()}`,
          quote: '',
          imagePrompt: 'p',
        })),
        teaser: t,
      }),
    });
    generateContent
      .mockResolvedValueOnce(teaserReply('first'))
      .mockResolvedValueOnce(teaserReply('last'));

    const feed = await generateChapterFeed(
      2,
      'Two',
      'A sentence of the chapter. '.repeat(1500),
      'Book',
    );

    expect(feed.teaser).toBe('last');
  });

  // A truncated JSON reply used to become a 0-card chapter on the first try.
  test('retries a segment whose reply came back sparse', async () => {
    generateContent
      .mockResolvedValueOnce({ text: '{"cards":[{"story":"b","quo' })
      .mockResolvedValueOnce(reply(6));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(feed.cards).toHaveLength(6);
  });

  test('keeps the better attempt when the retry is worse', async () => {
    generateContent.mockResolvedValueOnce(reply(2)).mockResolvedValueOnce(reply(0));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(feed.cards).toHaveLength(2);
  });

  // A failed request (no credits, bad key) must reach the UI as an error, not
  // become a silent "nothing could be condensed".
  test('a failed request throws instead of returning an empty feed', async () => {
    generateContent.mockRejectedValueOnce(new Error('OpenRouter 402: Insufficient credits'));

    await expect(generateChapterFeed(2, 'Two', chapter, 'Book')).rejects.toThrow('402');
  });

  test('does not retry a segment that filled its target', async () => {
    generateContent.mockResolvedValueOnce(reply(6));

    await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  // A long chapter is retold in several calls; each later one must pick up
  // where the story left off, or the seam reads as a restart.
  test('hands each later segment the end of the retelling so far', async () => {
    const long = 'A sentence of the chapter. '.repeat(1500); // 40.5k chars -> 2 segments
    generateContent.mockResolvedValue(reply(14));

    await generateChapterFeed(2, 'Two', long, 'Book');

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(promptOf(0)).not.toContain('Part 13 of the retelling.');
    expect(promptOf(1)).toContain('Part 13 of the retelling.');
  });

  describe("cards in the feed's language", () => {
    const replyIn = (story: string, quote = '') => ({
      text: JSON.stringify({
        cards: Array.from({ length: 6 }, () => ({
          story: Array(20).fill(story).join(' '),
          quote,
          imagePrompt: 'p',
        })),
      }),
    });

    test('repeats the language rule after the chapter text', async () => {
      generateContent.mockResolvedValueOnce(reply(6));
      await generateChapterFeed(2, 'Two', chapter, 'Book');
      const prompt = promptOf(0);
      expect(
        prompt.trimEnd().endsWith('Remember: write every field except "quote" in English.'),
      ).toBe(true);
      expect(prompt).toMatch(/"label", "title", "story", "points", "example" and "teaser"/);
    });

    // Given a long Russian chapter the model sometimes answered in Russian
    // under an English picker.
    test("retries once, firmly, when the cards come back in the chapter's language", async () => {
      generateContent
        .mockResolvedValueOnce(replyIn('Алиса бежит за Белым Кроликом.'))
        .mockResolvedValueOnce(replyIn('Alice runs after the White Rabbit.'));

      const feed = await generateChapterFeed(2, 'Two', chapter, 'Book', 'story', 'en');

      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(promptOf(1)).toMatch(/IMPORTANT: your previous answer was not in English/);
      expect(feed.cards[0]!.story).toContain('Alice runs after the White Rabbit.');
    });

    test("drops quotes that are not in the card's language", async () => {
      generateContent.mockResolvedValueOnce(
        replyIn('Alice runs after the White Rabbit.', 'Sentence number 0 is here.'),
      );
      const english = await generateChapterFeed(2, 'Two', chapter, 'Book', 'story', 'en');
      expect(english.cards[0]!.quote).toBe('Sentence number 0 is here.');

      generateContent.mockResolvedValueOnce(
        replyIn('Алиса бежит за Белым Кроликом.', 'Sentence number 0 is here.'),
      );
      const russian = await generateChapterFeed(2, 'Two', chapter, 'Book', 'story', 'ru');
      expect(russian.cards[0]!.quote).toBe('');
    });
  });
});
