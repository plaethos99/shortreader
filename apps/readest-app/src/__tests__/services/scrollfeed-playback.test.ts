import { describe, expect, test } from 'vitest';

import {
  FEED_SPEEDS,
  clampRate,
  defaultVoiceId,
  resumePoint,
  shouldPrefetchNext,
  spokenText,
  voicesForLang,
} from '@/services/scrollfeed/playback';

describe('shouldPrefetchNext', () => {
  // Condensing a chapter takes a Gemini round trip, so reaching the end of one
  // and tapping the next means staring at "Condensing…". Starting the next
  // chapter while the reader still has cards left hides that latency.
  test('fires once the reader is near the end of the chapter', () => {
    expect(shouldPrefetchNext(17, 20)).toBe(true);
    expect(shouldPrefetchNext(19, 20)).toBe(true);
  });

  // Not at the start: prefetching chapter N+1 the instant chapter N opens would
  // spend a call on a chapter the reader may never reach.
  test('does not fire early in the chapter', () => {
    expect(shouldPrefetchNext(0, 20)).toBe(false);
    expect(shouldPrefetchNext(10, 20)).toBe(false);
  });

  test('a chapter shorter than the trigger window prefetches from its last card', () => {
    expect(shouldPrefetchNext(0, 2)).toBe(false);
    expect(shouldPrefetchNext(1, 2)).toBe(true);
  });

  test('an empty chapter never prefetches', () => {
    expect(shouldPrefetchNext(0, 0)).toBe(false);
  });
});

describe('voicesForLang', () => {
  const voices = [
    { name: 'Aria', id: 'en-US-AriaNeural', lang: 'en-US' },
    { name: 'Ryan', id: 'en-GB-RyanNeural', lang: 'en-GB' },
    { name: 'Denise', id: 'fr-FR-DeniseNeural', lang: 'fr-FR' },
    { name: 'Swara', id: 'hi-IN-SwaraNeural', lang: 'hi-IN' },
  ];

  // Edge ships 296 voices across 127 languages. A flat list of all of them is
  // not a picker, so it is narrowed to the book's language.
  test('narrows to the language, matching regional variants', () => {
    expect(voicesForLang(voices, 'en').map((v) => v.id)).toEqual([
      'en-US-AriaNeural',
      'en-GB-RyanNeural',
    ]);
  });

  test('accepts a full locale, not just a bare language code', () => {
    expect(voicesForLang(voices, 'fr-FR').map((v) => v.id)).toEqual(['fr-FR-DeniseNeural']);
  });

  // A book tagged with a language Edge has no voice for must still be readable
  // aloud rather than presenting an empty picker.
  test('falls back to English when the language has no voices', () => {
    expect(voicesForLang(voices, 'cy').map((v) => v.id)).toEqual([
      'en-US-AriaNeural',
      'en-GB-RyanNeural',
    ]);
  });

  test('an absent language is treated as English', () => {
    expect(voicesForLang(voices, '').map((v) => v.id)).toEqual([
      'en-US-AriaNeural',
      'en-GB-RyanNeural',
    ]);
  });
});

describe('defaultVoiceId', () => {
  // Edge's list is grouped by locale, so "first in the list" for English is
  // en-AU — an Australian narrator for an American novel, chosen by nothing
  // more than alphabetical order of locale codes.
  test('prefers the house default voice when the language offers it', () => {
    const voices = [
      { name: 'Natasha', id: 'en-AU-NatashaNeural', lang: 'en-AU' },
      { name: 'Aria', id: 'en-US-AriaNeural', lang: 'en-US' },
    ];

    expect(defaultVoiceId(voices)).toBe('en-US-AriaNeural');
  });

  test('falls back to the first voice for a language the default is not in', () => {
    const voices = [
      { name: 'Denise', id: 'fr-FR-DeniseNeural', lang: 'fr-FR' },
      { name: 'Henri', id: 'fr-FR-HenriNeural', lang: 'fr-FR' },
    ];

    expect(defaultVoiceId(voices)).toBe('fr-FR-DeniseNeural');
  });

  test('an empty voice list yields no voice rather than throwing', () => {
    expect(defaultVoiceId([])).toBe('');
  });
});

describe('clampRate', () => {
  test('keeps a supported speed as-is', () => {
    expect(clampRate(1.5)).toBe(1.5);
  });

  // A rate restored from storage may predate a change to the speed list, and
  // Edge rejects values outside its range outright.
  test('snaps an unsupported or out-of-range speed to the nearest supported one', () => {
    expect(clampRate(1.3)).toBe(1.25);
    expect(clampRate(99)).toBe(FEED_SPEEDS[FEED_SPEEDS.length - 1]);
    expect(clampRate(0)).toBe(FEED_SPEEDS[0]);
  });

  test('a missing or unparseable speed falls back to normal', () => {
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(undefined)).toBe(1);
  });
});

describe('resumePoint', () => {
  const chapters = [
    { idx: 0, title: 'One', text: 'a' },
    { idx: 1, title: 'Two', text: 'b' },
  ];

  test('returns the stored chapter when it still exists', () => {
    expect(resumePoint(chapters, { chapterIdx: 1, cardIdx: 4 })).toEqual({
      chapterIdx: 1,
      cardIdx: 4,
    });
  });

  // A re-imported or edited book can extract to fewer chapters than the stored
  // progress refers to. Resuming into a chapter that no longer exists would
  // open an empty feed with no way back except the chapter list.
  test('discards progress pointing past the end of the book', () => {
    expect(resumePoint(chapters, { chapterIdx: 9, cardIdx: 0 })).toBeNull();
  });

  test('no stored progress means no resume', () => {
    expect(resumePoint(chapters, null)).toBeNull();
  });
});

describe('spokenText', () => {
  const card = {
    id: '0-0',
    chapterIdx: 0,
    label: '',
    title: '',
    points: [] as string[],
    example: '',
    story: 'Circe watches the ship.',
    quote: '',
    imagePrompt: 'p',
  };

  test('a story card reads the paragraph, then the author line if any', () => {
    expect(spokenText(card)).toBe('Circe watches the ship.');
    expect(spokenText({ ...card, quote: 'I did not look.' })).toBe(
      'Circe watches the ship. I did not look.',
    );
  });

  test('reads equations as words, not as LaTeX', () => {
    const text = spokenText({
      ...card,
      title: 'Speed',
      story: 'Speed is $v = \\frac{d}{t}$.',
      points: ['Energy: $E = mc^2$'],
    });

    expect(text).toContain('v equals d over t');
    expect(text).toContain('E equals mc squared');
    expect(text).not.toMatch(/[$\\]/);
  });

  // Code read aloud is noise ("open paren, const x equals..."); the points
  // are the substance of a technique card and must be heard.
  test('a headed card reads title, paragraph and points, never the code example', () => {
    const text = spokenText({
      ...card,
      label: 'Concept',
      title: 'Replication',
      story: 'Copies of data live on several machines.',
      points: ['Leaders take writes', 'Followers apply the log'],
      example: 'SELECT * FROM t;',
    });

    expect(text).toBe(
      'Replication. Copies of data live on several machines. Leaders take writes. Followers apply the log.',
    );
  });
});
