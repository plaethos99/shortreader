/**
 * What kind of book this is, and so what a feed card should be made of.
 *
 * A novel reads best retold as a story; a programming book as its core
 * concepts; a self-help book as the techniques it teaches. One classification
 * call per book, cached by the caller, picks the style.
 */
import { chatJson } from '../llm';
import { FEED_MOODS, type FeedMood, toMood } from './ambience';

export const FEED_STYLES = ['story', 'concepts', 'techniques', 'ideas'] as const;
export type FeedStyle = (typeof FEED_STYLES)[number];

export const FEED_STYLE_LABELS: Record<FeedStyle, string> = {
  story: 'Story',
  concepts: 'Core concepts',
  techniques: 'Techniques',
  ideas: 'Key ideas',
};

export interface BookInfo {
  title: string;
  author?: string;
  description?: string;
}

// Enough of the opening to see the voice and subject; the title, TOC-ish front
// matter and first pages decide it. More only costs tokens.
const SAMPLE_CHARS = 5000;

const isFeedStyle = (value: unknown): value is FeedStyle =>
  FEED_STYLES.includes(value as FeedStyle);

/** Classify a book into a feed style. Unknown answers fall back to 'ideas';
 * a failed call throws, so the caller doesn't cache a guess it never got. */
export async function detectFeedStyle(book: BookInfo, sample: string): Promise<FeedStyle> {
  const prompt = `Classify this book to choose how to condense it for a reading feed.

- "story": fiction, literature, poetry, drama, fables — anything read for its narrative.
- "concepts": technical or textbook material — programming, engineering, maths, science, medicine, finance — read to learn how things work.
- "techniques": self-help, productivity, psychology, health, relationships, business advice — read for methods to apply to one's own life.
- "ideas": other non-fiction — history, biography, memoir, essays, politics, popular science, philosophy — read for its arguments and events.

Title: ${book.title}
Author: ${book.author || 'Unknown'}
Description: ${(book.description || '').slice(0, 800)}

Opening of the book:
${sample.slice(0, SAMPLE_CHARS)}

Return JSON: {"style": "story" | "concepts" | "techniques" | "ideas"}.`;

  const reply = await chatJson<{ style?: unknown }>(prompt);
  return isFeedStyle(reply.style) ? reply.style : 'ideas';
}

// The mood needs less of the text than the style: the opening lines set it.
const MOOD_SAMPLE_CHARS = 2000;

/** The book's mood, which picks the feed's colours. Unknown answers are
 * 'calm'; a failed call throws, so the caller doesn't cache a guess. */
export async function detectFeedMood(book: BookInfo, sample: string): Promise<FeedMood> {
  const moods = FEED_MOODS.map((m) => `"${m.id}" (${m.label})`).join(', ');
  const prompt = `Pick the mood that best fits this book, to colour its reading feed: ${moods}.
"calm" suits anything that fits none of the others.

Title: ${book.title}
Author: ${book.author || 'Unknown'}
Description: ${(book.description || '').slice(0, 600)}

Opening of the book:
${sample.slice(0, MOOD_SAMPLE_CHARS)}

Return JSON: {"mood": string}.`;

  const reply = await chatJson<{ mood?: unknown }>(prompt);
  return toMood(reply.mood);
}
