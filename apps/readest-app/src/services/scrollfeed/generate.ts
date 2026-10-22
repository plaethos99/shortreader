import { chatJson } from '../llm';
import { isTextAIConfigured } from '../byok/aiConfig';
import {
  countWords,
  isSparse,
  normalizeCards,
  RawFeedCard,
  RETELLING_RATIO,
  targetCardCount,
} from './cards';
import type { FeedStyle } from './genre';
import { feedLanguage } from './language';
import { isInLanguage } from './script';
import { renumberCards, segmentChapter } from './segments';
import { FEED_FORMAT, FeedCard, ChapterFeed } from './types';

export const isScrollFeedConfigured = isTextAIConfigured;

// A chapter past this is SEGMENTED, not truncated: every segment gets its own
// call so the whole chapter reaches the model. It was 80k, but asked for ~30
// cards in one reply DeepSeek ignores the budget: a 9.3k-word Russian chapter
// came back as 10.8k words. At 24k (~10 cards a call) the same chapter came to
// 6k words, with 16 verbatim quotes instead of 2.
const MAX_CHAPTER_CHARS = 24000;

// Unset, DeepSeek cuts a reply off at 8192 tokens — mid-JSON, which parsed to
// zero cards. Cards written in a non-Latin script cost several times the
// tokens of English, so leave plenty of room. Billed only as used.
const MAX_REPLY_TOKENS = 32768;

// Rounded so the prompt reads as guidance ("about 1100 words"), not a quota.
const retellingWords = (text: string): number =>
  Math.max(50, Math.round((countWords(text) * RETELLING_RATIO) / 50) * 50);

// The total split evenly, rounded to 10. A range ("80-130 words") let the
// model write at the top of it: Circe's Chapter One came back at 47%, not 33%.
const cardWords = (text: string, cardCount: number): number =>
  Math.max(40, Math.round(retellingWords(text) / cardCount / 10) * 10);

interface StyleSpec {
  // What the feed is, in one line: "retelling ... as a condensed narrative".
  task: string;
  // What "nothing important is missed" means for this kind of book.
  coverage: string;
  // The card fields specific to this style.
  fields: string;
  quoteHint: string;
  imageHint: string;
}

const headedFields = (kind: string, labels: string): string => `- "label": ${labels}.
- "title": the name of this ${kind}, a few words.
- "story": one paragraph, about WORDS words, never more than MAX, explaining it
  in plain language — what it is, why it matters, how it connects to the
  previous card. Present it as the author's teaching ("X argues...", or direct
  explanation), with no commentary about the chapter or the reader.`;

const STYLE_SPECS: Record<FeedStyle, StyleSpec> = {
  story: {
    task: 'retelling a chapter of BOOK as a condensed narrative',
    coverage: `every event, decision, revelation, shift in a relationship and
turn of feeling, in the order the chapter gives them. Trim repetition and
description, never plot.`,
    fields: `- "story": one paragraph of flowing narrative prose,
  about WORDS words, never more than MAX,
  that picks up exactly where the previous card left off. Third person, present tense, even if
  the book is written in the first person. Keep the book's names, mood and
  concrete detail. No commentary about the chapter, the author or the reader, no
  headings, no lists — it should read like a novel, not a summary.
- "label", "title", "example": "". "points": [].`,
    quoteHint: 'that the paragraph leads up to rather than repeats',
    imageHint: 'this moment. Describe the scene, not the text',
  },
  concepts: {
    task: 'teaching a chapter of the technical book BOOK as its core concepts',
    coverage: `every core concept, definition, mechanism, trade-off and
technique the chapter introduces, in the order it builds them, so the reader
could follow the next chapter. A big concept may span consecutive cards; never
fold two concepts into one card.`,
    fields: `${headedFields('concept', '"Concept", "Technique", "Trade-off" or "Example"')}
- "points": 2-4 short key details — properties, steps, pitfalls, when to use it.
- "example": a short example from the chapter (a few lines of code, a command,
  a worked number) when it makes the concept click, else "". Keep code under
  12 lines.`,
    quoteHint: 'such as a crisp definition or rule of thumb',
    imageHint: 'the concept as a clear diagram or visual metaphor',
  },
  techniques: {
    task: 'distilling a chapter of the self-help book BOOK into the techniques it teaches',
    coverage: `every technique, principle, exercise and habit the chapter
recommends, with the author's reasoning and key evidence or stories, in order.
A technique with several steps may span consecutive cards.`,
    fields: `${headedFields('technique or principle', '"Technique", "Principle", "Exercise" or "Story"')}
- "points": 2-4 short, concrete how-to-apply steps or cues ("When X, do Y").
  For a "Story" card, the lesson it carries.
- "example": "".`,
    quoteHint: "such as the author's most memorable line on it",
    imageHint: 'someone applying this in everyday life',
  },
  ideas: {
    task: 'distilling a chapter of the non-fiction book BOOK into its key ideas',
    coverage: `every key idea, argument, event and turning point, with the
evidence, examples and people behind it, in the order the chapter gives them.`,
    fields: `${headedFields('idea, argument or event', '"Key idea", "Argument", "Event" or "Person"')}
- "points": 1-3 short supporting facts, dates or examples.
- "example": "".`,
    quoteHint: 'such as a line that captures the argument',
    imageHint: 'this idea or event',
  },
};

// Written in the target language, not translated into it: same one call, same
// price. The quote is excluded because it is verified character-for-character
// against the chapter — a translated quote would be words the author never
// wrote — so a quote is only kept when the chapter is in the card's language.
// English is named too: left unsaid, the model writes in the book's language,
// and a Russian book came back in Russian under an English picker. Given a long
// chapter in another language the model still drifts back to it, so the rule
// is repeated after the chapter (languageReminder) and the reply is checked
// (retellSegment).
const languageTarget = (code: string): string => {
  const language = feedLanguage(code);
  return language.code === 'en'
    ? 'English, whatever language the chapter is written in'
    : `${language.label} (${language.native}),
in that language's own script, as a fluent writer of it would — not as a
translation of English phrasing`;
};

const languageInstruction = (code: string): string => `
Write "label", "title", "story", "points", "example" and "teaser" in ${languageTarget(code)}.
Keep the names of people and places as the chapter gives them, transliterated
naturally. "quote" is the exception: copy it from the chapter text exactly as it
appears there and never translate it — and when the chapter is not written in
${feedLanguage(code).label}, use "" for every quote.
`;

const languageReminder = (code: string, insist: boolean): string => {
  const label = feedLanguage(code).label;
  return insist
    ? `

IMPORTANT: your previous answer was not in ${label}. Write every field except "quote" in ${label} — the chapter's own language is only what you read, not what you write.`
    : `

Remember: write every field except "quote" in ${label}.`;
};

// The card UI renders LaTeX between $...$ (utils/mathText). One notation keeps
// every card renderable, and doubled backslashes keep JSON from decoding
// "\frac" as a form feed followed by "rac". Quotes are exempt: verbatim.
export const MATH_INSTRUCTION = `Write any equation, formula or symbol outside "quote" as LaTeX: inline between
$...$, or on its own between $$...$$. Inside JSON strings every backslash must be
doubled ("$v = \\\\frac{d}{t}$"). Plain words need no LaTeX.`;

const buildPrompt = (
  chapterTitle: string,
  chapterText: string,
  bookTitle: string,
  cardCount: number,
  storySoFar: string,
  style: FeedStyle,
  language: string,
  insistOnLanguage = false,
): string => {
  const spec = STYLE_SPECS[style];
  const words = cardWords(chapterText, cardCount);
  return `You are ${spec.task.replace('BOOK', `"${bookTitle}"`)} for a vertical
scrolling feed: ${cardCount} cards, about ${retellingWords(chapterText)} words in
total, read start to finish.

Read together, the cards must cover the WHOLE chapter so that someone who reads
only them misses nothing important: ${spec.coverage}

Each card has these parts:
${spec.fields.replace('WORDS', String(words)).replace('MAX', String(words + 20))}
- "quote": optional. At a key moment, one short line (under 30 words) copied
  character-for-character from the chapter text below — a contiguous span, not
  paraphrased or stitched together — ${spec.quoteHint}. Use "" when no line
  stands out; most cards need none. A quote that is not found verbatim is
  removed.
- "imagePrompt": a short concrete visual description of ${spec.imageHint}, for an
  illustration. Always in English — it is sent to an image model.
- "key": true on the card carrying the biggest idea, revelation or turn of its
  stretch — about one card in eight, at least one in all — else false. These
  cards get a reveal of their own, so keep them rare.

Also return "teaser": one line, under 20 words, ending on the open question or
tension these cards leave, so the reader wants to go on. Written like "story".
Nothing beyond the text below.
${languageInstruction(language)}${
  storySoFar
    ? `
This is a later part of a long chapter. The cards so far ended with:
"${storySoFar}"
Continue from there without restarting or recapping.
`
    : ''
}
${MATH_INSTRUCTION}
Return JSON: {"cards": [{"label": string, "title": string, "story": string, "points": string[], "example": string, "quote": string, "imagePrompt": string, "key": boolean}], "teaser": string}.

Chapter: "${chapterTitle}"

${chapterText}${languageReminder(language, insistOnLanguage)}`;
};

/** The cards' own words (not quotes) are in the feed's language. */
const cardsInLanguage = (cards: FeedCard[], teaser: string, language: string): boolean =>
  isInLanguage(
    [teaser, ...cards.flatMap((c) => [c.label, c.title, c.story, ...c.points, c.example])]
      .filter(Boolean)
      .join(' '),
    language,
  );

/** Retell one contiguous stretch of chapter text. Quotes are verified against
 * exactly the text the model was shown, so a segment's cards can only quote
 * that segment. */
async function retellSegment(
  chapterIdx: number,
  chapterTitle: string,
  segment: string,
  bookTitle: string,
  storySoFar: string,
  style: FeedStyle,
  language: string,
): Promise<{ cards: FeedCard[]; teaser: string }> {
  const cardCount = targetCardCount(segment);
  if (!cardCount) return { cards: [], teaser: '' };

  const ask = async (insistOnLanguage: boolean) => {
    let raw: RawFeedCard[] = [];
    let teaser = '';
    try {
      const reply = await chatJson<{ cards?: unknown; teaser?: unknown }>(
        buildPrompt(
          chapterTitle,
          segment,
          bookTitle,
          cardCount,
          storySoFar,
          style,
          language,
          insistOnLanguage,
        ),
        { maxTokens: MAX_REPLY_TOKENS },
      );
      raw = Array.isArray(reply.cards) ? (reply.cards as RawFeedCard[]) : [];
      teaser = typeof reply.teaser === 'string' ? reply.teaser.trim() : '';
    } catch (e) {
      // A failed request is an error worth showing; a malformed reply just
      // yields no cards for this segment (and a retry, see isSparse).
      if (!(e instanceof SyntaxError)) throw e;
    }
    return { cards: normalizeCards(raw, chapterIdx, segment), teaser };
  };

  let { cards, teaser } = await ask(false);
  // Answered in the chapter's language instead of the feed's: once more, firmly.
  if (cards.length && !cardsInLanguage(cards, teaser, language)) {
    const retry = await ask(true);
    if (retry.cards.length && cardsInLanguage(retry.cards, retry.teaser, language)) {
      ({ cards, teaser } = retry);
    }
  }
  // A quote stays in the chapter's language; on a card in another language it
  // would be read aloud by the wrong voice. Keep only quotes in the card's.
  cards = cards.map((card) =>
    card.quote && !isInLanguage(card.quote, language) ? { ...card, quote: '' } : card,
  );
  // A story card is bare narrative. The model sometimes adds a heading and
  // bullets that only repeat the paragraph; the prompt alone doesn't stop it.
  return {
    cards:
      style === 'story'
        ? cards.map((card) => ({ ...card, label: '', title: '', points: [], example: '' }))
        : cards,
    teaser,
  };
}

/** Condense one chapter into cards of the book's style. Returns [] for an
 * empty chapter. Segments run in order so the cards arrive in reading order,
 * each segment continuing where the previous one ended. */
export async function generateChapterFeed(
  chapterIdx: number,
  chapterTitle: string,
  chapterText: string,
  bookTitle: string,
  style: FeedStyle = 'story',
  language = 'en',
): Promise<ChapterFeed> {
  const segments = segmentChapter(chapterText, MAX_CHAPTER_CHARS);
  const groups: FeedCard[][] = [];
  let storySoFar = '';
  // The chapter's hook is the one its last stretch ends on.
  let teaser = '';
  for (const segment of segments) {
    const retell = () =>
      retellSegment(chapterIdx, chapterTitle, segment, bookTitle, storySoFar, style, language);
    let result = await retell();
    // One retry: a truncated reply is usually a one-off, and without it the
    // chapter opens as "nothing could be condensed".
    if (isSparse(result.cards.length, segment)) {
      const retry = await retell();
      if (retry.cards.length > result.cards.length) result = retry;
    }
    const { cards } = result;
    groups.push(cards);
    storySoFar = cards[cards.length - 1]?.story ?? storySoFar;
    teaser = result.teaser || teaser;
  }
  return {
    format: FEED_FORMAT,
    style,
    language,
    chapterIdx,
    title: chapterTitle,
    cards: renumberCards(...groups),
    teaser,
  };
}

// Chapters are retold ON DEMAND, one at a time, as the reader scrolls into
// them. A whole-book pass is not viable: chapter count follows TOC granularity,
// and a five-volume epic ships 510 TOC entries — 510 calls before the first
// card. See ScrollFeedView for the scroll-driven orchestration.
