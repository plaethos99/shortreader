import { describe, expect, test } from 'vitest';

import {
  BYTES_PER_SECOND,
  bookSections,
  chapterAt,
  chapterHeading,
  synthesizeBookAudio,
} from '@/services/scrollfeed/bookAudio';
import type { ChapterFeed, FeedCard } from '@/services/scrollfeed/types';

const card = (story: string) =>
  ({ id: story, title: '', story, points: [], quote: '' }) as unknown as FeedCard;
const feed = (chapterIdx: number, title: string, stories: string[]): ChapterFeed =>
  ({ chapterIdx, title, cards: stories.map(card) }) as unknown as ChapterFeed;

describe('Read all: the whole book as one recording', () => {
  test('announces each chapter in English when the title can be said', () => {
    expect(chapterHeading(3, 'A Caucus-Race and a Long Tale', 'en')).toBe(
      'Chapter 3. A Caucus-Race and a Long Tale.',
    );
    // A Russian title under English cards: the English voice says the number only.
    expect(chapterHeading(2, 'Глава вторая', 'en')).toBe('Chapter 2.');
    expect(chapterHeading(1, 'ಮೊದಲ ಅಧ್ಯಾಯ', 'kn')).toBe('ಮೊದಲ ಅಧ್ಯಾಯ.');
  });

  test('turns chapter feeds into spoken sections, skipping empty chapters', () => {
    const sections = bookSections(
      [
        feed(0, 'Down the Rabbit Hole', ['Alice is bored.']),
        feed(1, 'Empty', []),
        feed(2, 'Tears', ['She cries.']),
      ],
      'en',
    );
    expect(sections).toEqual([
      {
        chapterIdx: 0,
        title: 'Down the Rabbit Hole',
        parts: ['Chapter 1. Down the Rabbit Hole.', 'Alice is bored.'],
      },
      { chapterIdx: 2, title: 'Tears', parts: ['Chapter 2. Tears.', 'She cries.'] },
    ]);
  });

  test('keeps reading order while pieces are made in parallel, and times each chapter', async () => {
    const sections = bookSections(
      [feed(0, 'One', ['First card.']), feed(1, 'Two', ['Second card.'])],
      'en',
    );
    // Each piece "lasts" as many seconds as its text has characters / 10, and
    // later pieces finish first, to prove the order doesn't follow finishing.
    const synth = async (text: string) => {
      await new Promise((r) => setTimeout(r, 30 - text.length));
      return new Uint8Array(Math.round((text.length / 10) * BYTES_PER_SECOND)).fill(text.length)
        .buffer;
    };
    const progress: number[] = [];

    const audio = await synthesizeBookAudio(sections, {
      synth,
      onProgress: (done) => progress.push(done),
    });

    const pieces = ['Chapter 1. One.', 'First card.', 'Chapter 2. Two.', 'Second card.'];
    const bytes = new Uint8Array(await audio.blob.arrayBuffer());
    let offset = 0;
    for (const text of pieces) {
      expect(bytes[offset]).toBe(text.length);
      offset += Math.round((text.length / 10) * BYTES_PER_SECOND);
    }
    expect(audio.chapters).toEqual([
      { chapterIdx: 0, title: 'One', startSec: 0 },
      {
        chapterIdx: 1,
        title: 'Two',
        startSec:
          (Math.round(1.5 * BYTES_PER_SECOND) + Math.round(1.1 * BYTES_PER_SECOND)) /
          BYTES_PER_SECOND,
      },
    ]);
    expect(audio.durationSec).toBeCloseTo(offset / BYTES_PER_SECOND);
    expect(audio.blob.type).toBe('audio/mpeg');
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  test('stops when cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      synthesizeBookAudio(bookSections([feed(0, 'One', ['x.'])], 'en'), {
        synth: async () => new ArrayBuffer(1),
        signal: abort.signal,
      }),
    ).rejects.toThrow(/Cancelled/);
  });

  test('knows which chapter is playing', () => {
    const chapters = [
      { chapterIdx: 0, title: 'A', startSec: 0 },
      { chapterIdx: 1, title: 'B', startSec: 60 },
      { chapterIdx: 2, title: 'C', startSec: 125 },
    ];
    expect(chapterAt(chapters, 0)).toBe(0);
    expect(chapterAt(chapters, 59.9)).toBe(0);
    expect(chapterAt(chapters, 60)).toBe(1);
    expect(chapterAt(chapters, 400)).toBe(2);
  });
});
