/**
 * Scroll feed — a chapter condensed into swipeable cards.
 *
 * The cards read in order and together cover the whole chapter (about a third
 * of its length). What a card is made of follows the book's style: a novel is
 * retold as one continuous story, a technical book as its core concepts, a
 * self-help book as its techniques. A card may also carry one short VERBATIM
 * line from the author.
 */
import type { FeedStyle } from './genre';

// Bumped when the card shape or the generation style changes. Cached feeds of
// another format are regenerated instead of shown (v1 was beat + excerpt).
export const FEED_FORMAT = 2;

export interface FeedCard {
  // `${chapterIdx}-${ordinal}` — stable across regeneration of other chapters,
  // and the key generated images are cached under.
  id: string;
  chapterIdx: number;
  // Non-story styles only ('' / [] on a story card): a kind such as "Concept"
  // or "Technique", the concept or technique's name, a few short key details
  // or steps, and an optional short example (code, a worked case).
  label: string;
  title: string;
  points: string[];
  example: string;
  // One paragraph: the retelling, or the explanation of this card's idea.
  story: string;
  // Optional short line copied from the chapter, or ''. Verified against the
  // source before it is kept (see verifyQuote); a paraphrase is not a quote.
  quote: string;
  // Prompt for on-demand illustration of this card.
  imagePrompt: string;
  // The biggest idea or turn of its stretch: revealed with more ceremony.
  // Absent on feeds cached before key cards existed.
  key?: boolean;
}

export interface ChapterFeed {
  // Absent on feeds cached before formats were versioned.
  format?: number;
  // Absent on story feeds cached before styles existed.
  style?: FeedStyle;
  // Language the cards are written in; absent on feeds cached before the
  // picker existed, which were all English.
  language?: string;
  chapterIdx: number;
  title: string;
  cards: FeedCard[];
  // One line ending on the tension the chapter leaves, shown on the
  // chapter's closing card. Absent on older cached feeds.
  teaser?: string;
}
