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

// ~2:1 condensation: the chapter told more tightly, with its scenes, reasoning
// and voice still there. Each card is a ~100-word paragraph of the retelling,
// so half of a 30-page chapter (~9000 words) takes ~45 cards.
//
// This was 900 words per card (about 10:1), which reads as highlights, then 300
// (3:1), which still left readers feeling they had missed something.
const WORDS_PER_CARD = 200;
export const RETELLING_RATIO = 1 / 2;
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

// A reply under this share of the words asked for has left things out. Models
// differ in how concise they are, and counting cards alone can't see it: six
// 40-word cards pass as six cards.
const MIN_COVERAGE = 0.6;

export const fallsShort = (words: number, target: number): boolean => words < target * MIN_COVERAGE;

/** The words a reader gets from these cards, quotes aside. */
export const retoldWords = (cards: Pick<FeedCard, 'story' | 'points'>[]): number =>
  countWords(cards.flatMap((card) => [card.story, ...card.points]).join(' '));

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
