import { describe, expect, test } from 'vitest';

import {
  FEED_LANGUAGE_GROUPS,
  FEED_LANGUAGES,
  feedLanguage,
  resolveDefaultFeedLanguage,
} from '@/services/scrollfeed/language';

describe('feed languages', () => {
  test('offers English plus the major Indian languages, each with its own script', () => {
    const codes = FEED_LANGUAGES.map((l) => l.code);

    expect(codes).toContain('en');
    for (const code of ['hi', 'bn', 'te', 'ta', 'mr', 'gu', 'kn', 'ml', 'ur']) {
      expect(codes).toContain(code);
    }
    // Only languages Edge can narrate: offering one it cannot would read that
    // script aloud in an English voice.
    expect(codes).not.toContain('pa');
    expect(codes).not.toContain('or');
    // The picker shows each language in its own script, so a reader who wants
    // Telugu can find it without reading English.
    expect(feedLanguage('te').native).toBe('తెలుగు');
    expect(feedLanguage('te').label).toBe('Telugu');
  });

  // Read-along picks a narrator for the language the cards are written in, not
  // the language of the book they came from.
  test('each language names the voice locale to narrate it', () => {
    expect(feedLanguage('te').voiceLang).toBe('te-IN');
    expect(feedLanguage('hi').voiceLang).toBe('hi-IN');
    expect(feedLanguage('en').voiceLang).toBe('en');
  });

  // A book in any language can be retold into English, an Indian language or
  // a major international one; the picker groups the two sets.
  test('groups the languages as Indian and International, English on its own', () => {
    expect(feedLanguage('en').group).toBe('');
    expect(feedLanguage('te').group).toBe('indian');
    for (const code of ['es', 'fr', 'de', 'ru', 'ja', 'zh', 'ar', 'pt', 'ko']) {
      expect(feedLanguage(code).code).toBe(code);
      expect(feedLanguage(code).group).toBe('international');
    }
    expect(feedLanguage('ru').native).toBe('Русский');
    expect(feedLanguage('ru').voiceLang).toBe('ru-RU');
    const groups = FEED_LANGUAGE_GROUPS.map((g) => g.label);
    expect(groups).toEqual(['Indian', 'International']);
    // Every language sits in exactly one place in the picker.
    const listed = [
      ...FEED_LANGUAGES.filter((l) => !l.group),
      ...FEED_LANGUAGE_GROUPS.flatMap((g) => g.languages),
    ];
    expect(listed.map((l) => l.code).sort()).toEqual(FEED_LANGUAGES.map((l) => l.code).sort());
  });

  test('an unknown code falls back to English rather than throwing', () => {
    expect(feedLanguage('xx').code).toBe('en');
  });

  describe('resolveDefaultFeedLanguage', () => {
    // Every book starts in English, Indian-language books included; the
    // reader picks another language per book if they want one.
    test('starts every book in English, whatever it is written in', () => {
      expect(resolveDefaultFeedLanguage('kn')).toBe('en');
      expect(resolveDefaultFeedLanguage('te-IN')).toBe('en');
      expect(resolveDefaultFeedLanguage('HI')).toBe('en');
      expect(resolveDefaultFeedLanguage('ru')).toBe('en');
      expect(resolveDefaultFeedLanguage('th')).toBe('en');
    });

    test('falls back to English for a language not on the list, or none at all', () => {
      expect(resolveDefaultFeedLanguage('xx')).toBe('en');
      expect(resolveDefaultFeedLanguage(undefined)).toBe('en');
      expect(resolveDefaultFeedLanguage('')).toBe('en');
    });
  });
});
