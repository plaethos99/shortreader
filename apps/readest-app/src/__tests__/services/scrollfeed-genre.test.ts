import { beforeEach, describe, expect, test, vi } from 'vitest';

const { chatJson } = vi.hoisted(() => ({ chatJson: vi.fn() }));

vi.mock('@/services/llm', () => ({ chatJson }));

import { detectFeedMood, detectFeedStyle, FEED_STYLES } from '@/services/scrollfeed/genre';

const book = {
  title: 'Designing Data-Intensive Applications',
  author: 'Martin Kleppmann',
  description: 'The big ideas behind reliable, scalable systems.',
};

describe('detectFeedStyle', () => {
  beforeEach(() => chatJson.mockReset());

  test('classifies from the metadata and an opening sample', async () => {
    chatJson.mockResolvedValueOnce({ style: 'concepts' });

    expect(await detectFeedStyle(book, 'Chapter 1. Reliable, Scalable, and Maintainable')).toBe(
      'concepts',
    );
    const prompt: string = chatJson.mock.calls[0]![0];
    expect(prompt).toContain('Designing Data-Intensive Applications');
    expect(prompt).toContain('Martin Kleppmann');
    expect(prompt).toContain('The big ideas behind');
    expect(prompt).toContain('Reliable, Scalable, and Maintainable');
    for (const style of FEED_STYLES) expect(prompt).toContain(`"${style}"`);
  });

  test('keeps the prompt small: only an opening sample of the text is sent', async () => {
    chatJson.mockResolvedValueOnce({ style: 'story' });

    await detectFeedStyle(book, 'x'.repeat(100000));

    expect((chatJson.mock.calls[0]![0] as string).length).toBeLessThan(8000);
  });

  // A misread or invented label must not leave the feed without a style.
  test('an unknown answer falls back to key ideas', async () => {
    chatJson.mockResolvedValueOnce({ style: 'cookbook' });

    expect(await detectFeedStyle(book, 'text')).toBe('ideas');
  });

  test('a failed call is an error, so the guess is not saved as final', async () => {
    chatJson.mockRejectedValueOnce(new Error('OpenRouter 500: boom'));

    await expect(detectFeedStyle(book, 'text')).rejects.toThrow('500');
  });
});

// The mood picks the feed's colours: a space opera in deep blues, a romance
// in rose. One small call per book, cached by the caller.
describe('detectFeedMood', () => {
  beforeEach(() => chatJson.mockReset());

  test('asks for one of the moods from the metadata and a short opening', async () => {
    chatJson.mockResolvedValueOnce({ mood: 'scifi' });

    expect(await detectFeedMood(book, 'x'.repeat(100000))).toBe('scifi');
    const prompt: string = chatJson.mock.calls[0]![0];
    expect(prompt).toContain('Designing Data-Intensive Applications');
    for (const mood of ['calm', 'scifi', 'fantasy', 'romance', 'mystery', 'tech']) {
      expect(prompt).toContain(`"${mood}"`);
    }
    expect(prompt.length).toBeLessThan(5000);
  });

  test('an unknown answer is calm', async () => {
    chatJson.mockResolvedValueOnce({ mood: 'vaporwave' });

    expect(await detectFeedMood(book, 'text')).toBe('calm');
  });
});
