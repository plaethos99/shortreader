/**
 * Splitting a long chapter so the whole of it reaches the model.
 *
 * The generator used to send `chapterText.slice(0, MAX_CHAPTER_CHARS)`. Past
 * that the chapter was simply gone — a 200k-character chapter was condensed
 * from its first 40% and the rest never appeared in the feed, with nothing in
 * the UI to say so. Segmenting covers the chapter end to end instead, at the
 * cost of one model call per segment.
 */
import type { FeedCard } from './types';

// Sentence terminators, Latin and CJK. Kept in sync with aiSpeaker's chunker.
const SENTENCE_RE = /[^.!?。！？]+[.!?。！？]*\s*/g;

/**
 * Break a chapter into pieces no longer than `maxChars`, cutting only at
 * sentence boundaries. A chapter that already fits comes back as a single
 * segment, so the common case costs exactly one call.
 *
 * Cuts land between sentences because the model is asked for VERBATIM quotes
 * that are verified against the text it was given: a segment ending mid-
 * sentence invites a quote spanning the cut, which then fails verification and
 * costs a card at every boundary.
 */
export const segmentChapter = (text: string, maxChars: number): string[] => {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const segments: string[] = [];
  let current = '';

  for (const sentence of clean.match(SENTENCE_RE) ?? [clean]) {
    // A single sentence past the budget has no boundary to cut on. Hard-split
    // it rather than emit an over-budget segment or loop looking for one.
    if (sentence.length > maxChars) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      for (let i = 0; i < sentence.length; i += maxChars) {
        segments.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (current.length + sentence.length > maxChars && current.trim()) {
      segments.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) segments.push(current.trim());

  return segments;
};

/**
 * Flatten per-segment card lists into one sequentially numbered chapter feed.
 *
 * `normalizeCards` numbers from 0 for whatever text it was given, so every
 * segment hands back a card with ordinal 0. Merged as-is those ids collide,
 * which duplicates React keys and — because IndexedDB caches illustrations
 * under the card id — makes a later segment's image overwrite an earlier
 * card's.
 */
export const renumberCards = (...groups: FeedCard[][]): FeedCard[] =>
  groups.flat().map((card, i) => ({ ...card, id: `${card.chapterIdx}-${i}` }));
