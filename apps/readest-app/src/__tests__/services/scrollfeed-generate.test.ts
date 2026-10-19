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

// ~1800 words -> target 6 cards.
const chapter = `Sentence number 0 is here. ${'filler '.repeat(1800)}`;

const reply = (count: number) => ({
  text: JSON.stringify({
    cards: Array.from({ length: count }, (_, i) => ({
      story: `Part ${i} of the retelling.`,
      quote: '',
      imagePrompt: 'p',
    })),
  }),
});

const promptOf = (call: number): string => generateContent.mock.calls[call]![0];

describe('generateChapterFeed', () => {
  beforeEach(() => generateContent.mockReset());

  test('asks for a retelling that covers the whole chapter, about a third of its length', async () => {
    generateContent.mockResolvedValueOnce(reply(6));

    const feed = await generateChapterFeed(2, 'Two', chapter, 'Book');

    expect(feed.format).toBe(FEED_FORMAT);
    expect(feed.cards.map((c) => c.story)).toContain('Part 5 of the retelling.');
    const prompt = promptOf(0);
    expect(prompt).toContain('6 cards');
    expect(prompt).toMatch(/about 600 words/);
    // The budget is split per card, with a hard cap: "80-130 words" let the
    // model run at the top of the range and a chapter came back at 47%.
    expect(prompt).toMatch(/about 100 words, never more than 120/);
    expect(prompt).toContain('"story"');
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
    expect(prompt).not.toMatch(/Third person, present tense/);
  });

  // The story prompt asks for bare narrative; a one-card chapter came back
  // with a label, a title and bullet points repeating the paragraph anyway.
  test('story cards are bare narrative even when the model adds headings and points', async () => {
    generateContent.mockResolvedValueOnce({
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
    expect(promptOf(0)).toMatch(/Third person, present tense/);
  });

  // The cards are written in the chosen language rather than translated
  // afterwards, so it costs one call either way. The quote is the exception:
  // it is verified against the chapter, so a translated one would be a fake.
  test('asks for the cards in the chosen language and records it on the feed', async () => {
    generateContent.mockResolvedValueOnce(reply(6));

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
    expect(prompt).toMatch(/Write "story", "title" and "points" in English/);
    expect(prompt).not.toContain('Telugu');
  });

  // Asked for ~30 cards in one reply, DeepSeek ignored the word budget and a
  // Russian chapter came back longer than the original. Segments stay small.
  test('splits a 30k-character chapter rather than retelling it in one call', async () => {
    // 20 cards is never sparse here, so every call is a segment, not a retry.
    generateContent.mockResolvedValue(reply(20));

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
    generateContent.mockResolvedValueOnce({
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
        cards: Array.from({ length: 20 }, (_, i) => ({
          story: `S${i}`,
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
    generateContent.mockResolvedValue(reply(20));

    await generateChapterFeed(2, 'Two', long, 'Book');

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(promptOf(0)).not.toContain('Part 19 of the retelling.');
    expect(promptOf(1)).toContain('Part 19 of the retelling.');
  });
});
