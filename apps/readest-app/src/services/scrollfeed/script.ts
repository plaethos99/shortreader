/**
 * Is a piece of text in the language the feed asked for? Judged by writing
 * system, which is what goes visibly wrong: asked for English, a model given a
 * long Russian or Thai chapter sometimes answers in Cyrillic or Thai script.
 * (Latin-script languages can't be told apart this way; for those the prompt
 * alone has to do.)
 */
const SCRIPTS: Record<string, RegExp> = {
  latin: /\p{Script=Latin}/gu,
  cyrillic: /\p{Script=Cyrillic}/gu,
  devanagari: /\p{Script=Devanagari}/gu,
  bengali: /\p{Script=Bengali}/gu,
  telugu: /\p{Script=Telugu}/gu,
  tamil: /\p{Script=Tamil}/gu,
  kannada: /\p{Script=Kannada}/gu,
  malayalam: /\p{Script=Malayalam}/gu,
  gujarati: /\p{Script=Gujarati}/gu,
  arabic: /\p{Script=Arabic}/gu,
  han: /\p{Script=Han}/gu,
  japanese: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
  hangul: /\p{Script=Hangul}/gu,
  thai: /\p{Script=Thai}/gu,
  sinhala: /\p{Script=Sinhala}/gu,
};

const LANGUAGE_SCRIPT: Record<string, keyof typeof SCRIPTS> = {
  en: 'latin',
  es: 'latin',
  fr: 'latin',
  de: 'latin',
  pt: 'latin',
  it: 'latin',
  pl: 'latin',
  nl: 'latin',
  tr: 'latin',
  id: 'latin',
  vi: 'latin',
  sw: 'latin',
  ru: 'cyrillic',
  uk: 'cyrillic',
  hi: 'devanagari',
  mr: 'devanagari',
  ne: 'devanagari',
  bn: 'bengali',
  te: 'telugu',
  ta: 'tamil',
  kn: 'kannada',
  ml: 'malayalam',
  gu: 'gujarati',
  ur: 'arabic',
  ar: 'arabic',
  fa: 'arabic',
  zh: 'han',
  ja: 'japanese',
  ko: 'hangul',
  th: 'thai',
  si: 'sinhala',
};

const LETTER = /\p{L}/gu;

/** Share of the letters in `text` that are in `language`'s script; 1 for text
 * without letters, or a language we don't map. */
export const scriptShare = (text: string, language: string): number => {
  const script = LANGUAGE_SCRIPT[language];
  if (!script) return 1;
  const letters = text.match(LETTER)?.length ?? 0;
  if (!letters) return 1;
  return (text.match(SCRIPTS[script]!)?.length ?? 0) / letters;
};

/** Mostly in the language's script. Names and numbers in another script are
 * fine, hence a majority rather than all. */
export const isInLanguage = (text: string, language: string): boolean =>
  scriptShare(text, language) >= 0.6;
