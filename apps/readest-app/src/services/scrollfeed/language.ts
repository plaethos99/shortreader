/**
 * What language the feed is written in.
 *
 * The cards are WRITTEN by the model, not translated after the fact, so asking
 * for Telugu costs exactly what asking for English costs — one call either way.
 * The book itself can be in any language: the model reads it as it is. Quotes
 * are the exception: they are verified character-for-character against the
 * chapter, so they stay in the book's own words and are never translated.
 */

export type FeedLanguageGroup = '' | 'indian' | 'international';

export interface FeedLanguage {
  code: string;
  // English name, for the prompt.
  label: string;
  // The language's own name, for the picker.
  native: string;
  // Locale read-along narrates this language with (Edge TTS voice prefix).
  voiceLang: string;
  // Picker section; English stands on its own at the top.
  group: FeedLanguageGroup;
}

const indian = (code: string, label: string, native: string, voiceLang: string) =>
  ({ code, label, native, voiceLang, group: 'indian' }) as const;
const international = (code: string, label: string, native: string, voiceLang: string) =>
  ({ code, label, native, voiceLang, group: 'international' }) as const;

// Only languages Edge can narrate: offering one it cannot would read that
// script aloud in an English voice. Punjabi and Odia are absent for that
// reason; add them the day Edge has voices for them.
export const FEED_LANGUAGES: FeedLanguage[] = [
  { code: 'en', label: 'English', native: 'English', voiceLang: 'en', group: '' },
  indian('hi', 'Hindi', 'हिन्दी', 'hi-IN'),
  indian('bn', 'Bengali', 'বাংলা', 'bn-IN'),
  indian('te', 'Telugu', 'తెలుగు', 'te-IN'),
  indian('mr', 'Marathi', 'मराठी', 'mr-IN'),
  indian('ta', 'Tamil', 'தமிழ்', 'ta-IN'),
  indian('gu', 'Gujarati', 'ગુજરાતી', 'gu-IN'),
  indian('kn', 'Kannada', 'ಕನ್ನಡ', 'kn-IN'),
  indian('ml', 'Malayalam', 'മലയാളം', 'ml-IN'),
  indian('ur', 'Urdu', 'اردو', 'ur-IN'),
  international('es', 'Spanish', 'Español', 'es-ES'),
  international('fr', 'French', 'Français', 'fr-FR'),
  international('de', 'German', 'Deutsch', 'de-DE'),
  international('pt', 'Portuguese', 'Português', 'pt-BR'),
  international('it', 'Italian', 'Italiano', 'it-IT'),
  international('ru', 'Russian', 'Русский', 'ru-RU'),
  international('uk', 'Ukrainian', 'Українська', 'uk-UA'),
  international('pl', 'Polish', 'Polski', 'pl-PL'),
  international('nl', 'Dutch', 'Nederlands', 'nl-NL'),
  international('tr', 'Turkish', 'Türkçe', 'tr-TR'),
  international('ar', 'Arabic', 'العربية', 'ar-SA'),
  international('fa', 'Persian', 'فارسی', 'fa-IR'),
  international('zh', 'Chinese (Simplified)', '简体中文', 'zh-CN'),
  international('ja', 'Japanese', '日本語', 'ja-JP'),
  international('ko', 'Korean', '한국어', 'ko-KR'),
  international('id', 'Indonesian', 'Bahasa Indonesia', 'id-ID'),
  international('vi', 'Vietnamese', 'Tiếng Việt', 'vi-VN'),
  international('th', 'Thai', 'ไทย', 'th-TH'),
  international('ne', 'Nepali', 'नेपाली', 'ne-NP'),
  international('si', 'Sinhala', 'සිංහල', 'si-LK'),
  international('sw', 'Swahili', 'Kiswahili', 'sw-KE'),
];

/** The picker's sections, in order. English is listed above them. */
export const FEED_LANGUAGE_GROUPS = [
  { label: 'Indian', languages: FEED_LANGUAGES.filter((l) => l.group === 'indian') },
  { label: 'International', languages: FEED_LANGUAGES.filter((l) => l.group === 'international') },
];

/** The language for a code, falling back to English for anything unknown. */
export const feedLanguage = (code: string | undefined): FeedLanguage =>
  FEED_LANGUAGES.find((l) => l.code === code) ?? FEED_LANGUAGES[0]!;

/** What a book defaults to: an Indian-language book keeps its own language;
 * every other book starts in English, whatever it is written in. Metadata
 * carries locales ('te-IN') and odd casing ('HI'). */
export const resolveDefaultFeedLanguage = (bookLang: string | undefined): string => {
  const base = (bookLang || '').split(/[-_]/)[0]!.toLowerCase();
  return feedLanguage(base).group === 'indian' ? base : 'en';
};
