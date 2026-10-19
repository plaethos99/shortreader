import { beforeEach, describe, expect, test, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@/services/llm', () => ({
  chatJson: async (prompt: string, options?: { maxTokens?: number }) =>
    JSON.parse((await generateContent(prompt, options)).text),
}));

import {
  AUDIO_FORMAT,
  chapterScriptWords,
  generateChapterScript,
  isUsableScript,
  type AudioScript,
} from '@/services/scrollfeed/audiostory';
import type { FeedChapter } from '@/services/scrollfeed/chapters';

const chapter = (idx: number, chars: number): FeedChapter => ({
  idx,
  title: `Chapter ${idx}`,
  text: 'word '.repeat(chars / 5),
});

const reply = (paragraphs: string[]) => ({ text: JSON.stringify({ paragraphs }) });

describe('chapterScriptWords', () => {
  test('splits about an hour of narration across chapters by their length', () => {
    // A long book: 3 chapters of 300k chars (~60k words each).
    const chapters = [chapter(0, 300_000), chapter(1, 600_000), chapter(2, 300_000)];
    const words = chapters.map((_, i) => chapterScriptWords(chapters, i));
    expect(words[1]).toBe(words[0]! * 2);
    // ~60 minutes at ~150 words a minute.
    expect(words.reduce((a, b) => a + b, 0)).toBe(9000);
  });

  test('never pads a short book past half its own length', () => {
    const chapters = [chapter(0, 6000)]; // ~1200 words
    expect(chapterScriptWords(chapters, 0)).toBe(500);
  });

  test('budgets a scanned chapter by its page count until its text is read', () => {
    const scanned: FeedChapter = { idx: 1, title: 'Scan', text: '', scannedSections: [1, 2, 3] };
    expect(chapterScriptWords([chapter(0, 300_000), scanned], 1)).toBeGreaterThan(0);
  });
});

describe('generateChapterScript', () => {
  beforeEach(() => generateContent.mockReset());

  test('asks for spoken narration in the chosen language and keeps the paragraphs', async () => {
    generateContent.mockResolvedValueOnce(reply(['First part.', ' ', 'Second part.']));

    const script = await generateChapterScript(chapter(2, 5000), 'Book', 'story', 'te', 400);

    expect(script).toMatchObject({
      format: AUDIO_FORMAT,
      chapterIdx: 2,
      title: 'Chapter 2',
      style: 'story',
      language: 'te',
      paragraphs: ['First part.', 'Second part.'],
    });
    const prompt = generateContent.mock.calls[0]![0] as string;
    expect(prompt).toContain('about 400 words');
    expect(prompt).toContain('Telugu');
    expect(prompt).toMatch(/read aloud/i);
  });

  test('narrates a long chapter segment by segment, continuing from the last one', async () => {
    generateContent
      .mockResolvedValueOnce(reply(['Opening.']))
      .mockResolvedValueOnce(reply(['Ending.']));
    const long: FeedChapter = { idx: 0, title: 'Long', text: 'A sentence here. '.repeat(1000) };

    const script = await generateChapterScript(long, 'Book', 'ideas', 'en', 1000);

    expect(script.paragraphs).toEqual(['Opening.', 'Ending.']);
    expect(generateContent.mock.calls[1]![0]).toContain('Opening.');
  });

  // A Russian chapter scripted in English came back as a full translation:
  // 14,867 words against a 2,410-word budget.
  test('asks to condense, not translate, with the ratio spelled out', async () => {
    generateContent.mockResolvedValueOnce(reply(['Part.']));

    await generateChapterScript(chapter(0, 10_000), 'Book', 'story', 'en', 400);

    const prompt = generateContent.mock.calls[0]![0] as string;
    expect(prompt).toMatch(/not a translation/i);
    // 2000 words of text into 400: one in five, in 6 short paragraphs.
    expect(prompt).toContain('2000 words');
    expect(prompt).toContain('1 in 5');
    expect(prompt).toMatch(/6 paragraphs of 50-90 words/);
  });

  // Telugu costs several times the tokens of English; at DeepSeek's default
  // 8192-token cap a reply was cut off mid-JSON and the chapter failed.
  test('leaves room for long replies in non-Latin scripts', async () => {
    generateContent.mockResolvedValueOnce(reply(['Part.']));

    await generateChapterScript(chapter(0, 5000), 'Book', 'story', 'te', 400);

    expect(generateContent.mock.calls[0]![1]).toEqual({ maxTokens: 32768 });
  });

  test('retries a cut-off reply, then skips that segment rather than failing', async () => {
    const cutOff = { text: '{"paragraphs": ["Half a sen' };
    generateContent
      .mockResolvedValueOnce(cutOff)
      .mockResolvedValueOnce(reply(['Retried.']))
      .mockResolvedValueOnce(cutOff)
      .mockResolvedValueOnce(cutOff);
    const long: FeedChapter = { idx: 0, title: 'Long', text: 'A sentence here. '.repeat(1000) };

    const script = await generateChapterScript(long, 'Book', 'story', 'te', 1000);

    expect(script.paragraphs).toEqual(['Retried.']);
    expect(generateContent).toHaveBeenCalledTimes(4);
  });
});

describe('isUsableScript', () => {
  const script: AudioScript = {
    format: AUDIO_FORMAT,
    chapterIdx: 0,
    title: 'Chapter 0',
    style: 'story',
    language: 'en',
    paragraphs: ['Hi.'],
  };

  test('reuses a script made for the same chapter, style and language', () => {
    expect(isUsableScript(script, chapter(0, 100), 'story', 'en')).toBe(true);
  });

  test.each([
    ['another chapter', { title: 'Other' }],
    ['another style', { style: 'ideas' as const }],
    ['another language', { language: 'hi' }],
    ['an older format', { format: AUDIO_FORMAT - 1 }],
    ['no paragraphs', { paragraphs: [] }],
  ])('regenerates one made for %s', (_, change) => {
    expect(isUsableScript({ ...script, ...change }, chapter(0, 100), 'story', 'en')).toBe(false);
  });
});
