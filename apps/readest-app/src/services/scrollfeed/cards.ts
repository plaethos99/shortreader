import { ChapterFeed, FeedCard } from './types';

// Raw card shape as the model returns it, before verification.
export interface RawFeedCard {
  story: string;
  quote: string;
  imagePrompt: string;
  label?: string;
  title?: string;
  points?: string[];
  example?: string;
  key?: unknown;
}

// A card is read on one screen; past this the list stops being key points.
const MAX_POINTS = 4;

// 5:2 condensation: the chapter told anew, with its scenes and reasoning still
// there. Each card is a ~100-word paragraph of the retelling, so 40% of a
// 30-page chapter (~9000 words) takes ~36 cards.
//
// This was 900 words per card (about 10:1), which reads as highlights, then 300
// (3:1), which still left readers feeling they had missed something, then 200
// (2:1), which asked so little condensing that the book itself came back.
const WORDS_PER_CARD = 250;
export const RETELLING_RATIO = 2 / 5;
// One, not three: a 3-card floor turned a 150-word page into ~120 words of
// cards — a near-copy padded with invented detail, not a retelling.
const MIN_CARDS = 1;
const MAX_CARDS = 40;

// Scripts written without spaces between words, and about how many characters
// make the equivalent of an English word. Counted by spaces, a Chinese chapter
// was one "word" and got one card; a Thai one got a tenth of its share.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const CJK_CHARS_PER_WORD = 2;
const SOUTHEAST_ASIAN = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;
const SOUTHEAST_ASIAN_CHARS_PER_WORD = 4;

export const countWords = (text: string): number => {
  const cjk = text.match(CJK)?.length ?? 0;
  const southeastAsian = text.match(SOUTHEAST_ASIAN)?.length ?? 0;
  const spaced = text
    .replace(CJK, ' ')
    .replace(SOUTHEAST_ASIAN, ' ')
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  return Math.round(
    spaced + cjk / CJK_CHARS_PER_WORD + southeastAsian / SOUTHEAST_ASIAN_CHARS_PER_WORD,
  );
};

// A retelling has to land between two failures. Under MIN_COVERAGE of the words
// asked for it has left things out: models differ in how concise they are, and
// counting cards alone can't see it, six 40-word cards pass as six cards. Over
// MAX_COVERAGE, or with more than MAX_COPIED of it lifted word for word, it is
// the book handed back, and a translated book can only show up in its length.
const MIN_COVERAGE = 0.7;
const MAX_COVERAGE = 1.3;
const MAX_COPIED = 0.25;
// This many words in a row came from the book; fewer can be a shared phrase.
const COPIED_RUN = 6;
// A title page or an epigraph isn't worth a second call.
const MIN_CHECKED_WORDS = 150;

const matchableWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(CJK, ' $& ')
    .replace(SOUTHEAST_ASIAN, ' $& ')
    .match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/** How much of a retelling sits in runs of words found unchanged in the source. */
export const copiedShare = (retelling: string, source: string): number => {
  const words = matchableWords(retelling);
  if (!words.length) return 0;
  const sourceWords = matchableWords(source);
  const runs = new Set<string>();
  for (let i = 0; i + COPIED_RUN <= sourceWords.length; i++) {
    runs.add(sourceWords.slice(i, i + COPIED_RUN).join(' '));
  }
  let copied = 0;
  let countedTo = 0;
  for (let i = 0; i + COPIED_RUN <= words.length; i++) {
    if (!runs.has(words.slice(i, i + COPIED_RUN).join(' '))) continue;
    copied += i + COPIED_RUN - Math.max(i, countedTo);
    countedTo = i + COPIED_RUN;
  }
  return copied / words.length;
};

export interface RetellingCheck {
  words: number;
  problem: 'short' | 'long' | 'copied' | null;
  // How far outside the balance it is, to choose between two attempts.
  miss: number;
}

export const checkRetelling = (
  retelling: string,
  source: string,
  target: number,
): RetellingCheck => {
  const words = countWords(retelling);
  if (countWords(source) < MIN_CHECKED_WORDS) return { words, problem: null, miss: 0 };
  const short = Math.max(0, MIN_COVERAGE - words / target);
  const long = Math.max(0, words / target - MAX_COVERAGE);
  const copied = Math.max(0, copiedShare(retelling, source) - MAX_COPIED);
  const problem = short ? 'short' : copied ? 'copied' : long ? 'long' : null;
  return { words, problem, miss: short + long + copied };
};

/** Told once a reply misses: asked the same way, a model answers the same way. */
export const retellingCorrection = (
  { words, problem }: RetellingCheck,
  target: number,
  reply: 'answer' | 'script',
): string => {
  const keep = 'keeping every scene, argument and example the chapter has';
  if (problem === 'short' && words) {
    return `IMPORTANT: your previous ${reply} was only about ${words} words and left too much out. Write the full ${target} words in your own sentences, ${keep}.`;
  }
  if (problem === 'copied') {
    return `IMPORTANT: your previous ${reply} copied long stretches of the chapter word for word, which only hands back the book. Retell all of it in your own sentences, in about ${target} words, ${keep}.`;
  }
  if (problem === 'long') {
    return `IMPORTANT: your previous ${reply} ran to about ${words} words, too close to the chapter itself. Retell it in your own sentences, in about ${target} words, ${keep}.`;
  }
  return '';
};

/** The words a reader gets from these cards, quotes aside. */
export const retoldText = (cards: Pick<FeedCard, 'story' | 'points'>[]): string =>
  cards.flatMap((card) => [card.story, ...card.points]).join(' ');

export const targetCardCount = (chapterText: string): number => {
  const words = countWords(chapterText);
  if (!words) return 0;
  return Math.min(MAX_CARDS, Math.max(MIN_CARDS, Math.round(words / WORDS_PER_CARD)));
};

/** Under half the target: the reply was truncated or blocked, not a retelling
 * of the chapter. Worth another attempt, and never worth caching as the
 * chapter's feed. */
export const isSparse = (cardCount: number, chapterText: string): boolean =>
  cardCount < Math.ceil(targetCardCount(chapterText) / 2);

// Quotes are compared on a normalized form so that source line wrapping, run-on
// spacing and curly/straight quote marks don't fail an otherwise real excerpt.
// Comparison is deliberately NOT case- or punctuation-insensitive beyond this:
// loosening further starts accepting paraphrases, which is what this guards.
const normalizeForMatch = (text: string): string =>
  text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/["']/g, '').replace(/\s+/g, ' ').trim();

export const verifyQuote = (quote: string, chapterText: string): boolean => {
  const needle = normalizeForMatch(quote);
  if (!needle) return false;
  return normalizeForMatch(chapterText).includes(needle);
};

/** A cached feed with every card field present. Cards cached before a field
 * existed lack it, and the card view reads them all (`...card.points` threw
 * "not iterable" on a story feed cached earlier the same day). */
export const withCardDefaults = (feed: ChapterFeed): ChapterFeed => ({
  ...feed,
  cards: feed.cards.map((card) => ({
    ...card,
    label: card.label ?? '',
    title: card.title ?? '',
    points: Array.isArray(card.points) ? card.points : [],
    example: card.example ?? '',
  })),
});

/**
 * Verify and shape the model's cards for one chapter.
 *
 * A quote that cannot be found in the chapter is REMOVED — models paraphrase
 * when asked for verbatim text, and invented prose must never be shown as the
 * author's words. The card itself stays: the retelling carries the chapter,
 * and dropping a paragraph of it would leave a hole in the story. Ids are
 * assigned after filtering so they stay sequential.
 */
export const normalizeCards = (
  raw: RawFeedCard[],
  chapterIdx: number,
  chapterText: string,
): FeedCard[] => {
  const cards: FeedCard[] = [];
  // The model's JSON is unvalidated: a field may be missing or not a string.
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  for (const item of raw) {
    const story = text(item?.story);
    if (!story) continue;
    const quote = text(item.quote);
    cards.push({
      id: `${chapterIdx}-${cards.length}`,
      chapterIdx,
      label: text(item.label),
      title: text(item.title),
      points: (Array.isArray(item.points) ? item.points : [])
        .map(text)
        .filter(Boolean)
        .slice(0, MAX_POINTS),
      example: text(item.example),
      story,
      quote: quote && verifyQuote(quote, chapterText) ? quote : '',
      imagePrompt: text(item.imagePrompt) || story,
      // Only a real true: "yes" or 1 is the model not following the shape.
      key: item.key === true,
    });
  }
  return cards;
};
