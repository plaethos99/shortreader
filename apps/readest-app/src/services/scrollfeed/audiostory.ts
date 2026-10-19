/**
 * Audio story: the whole book retold as about an hour of narration, in the
 * manner of lystn's audiostories — listened to, not read.
 *
 * The hour is split across chapters by their length, and each chapter's
 * script is written on demand, like the feed's cards: a book with hundreds of
 * TOC entries can't be scripted in one pass before the first word is heard.
 */
import { chatJson } from '../llm';
import { countWords } from './cards';
import type { FeedChapter } from './chapters';
import type { FeedStyle } from './genre';
import { feedLanguage } from './language';
import { segmentChapter } from './segments';

// Bump when the script shape or prompt changes enough to discard cached ones.
// v2: condensed, not translated (v1 scripts of foreign books ran ~6x long).
export const AUDIO_FORMAT = 2;

const STORY_MINUTES = 60;
// A narrator's pace: Edge voices at 1x read prose at ~150 words a minute.
export const WORDS_PER_MINUTE = 150;
const STORY_WORDS = STORY_MINUTES * WORDS_PER_MINUTE;
// A short book is condensed, never padded: at most half its own length.
const CHARS_PER_WORD = 6;
// A scanned chapter has no text until its pages are read; a page is about this.
const CHARS_PER_SCANNED_PAGE = 2000;
// Half the feed's cut. Fed 24k chars of a Russian chapter, DeepSeek wrote
// ~2.7x the English budget; at 12k it kept to ~1.2x and the paragraph count.
const MAX_SEGMENT_CHARS = 12000;
// Spoken paragraphs of 2-5 sentences.
const PARAGRAPH_WORDS = 70;
// Unset, DeepSeek stops at 8192 tokens; a Telugu script was cut off mid-JSON
// well before its budget. Billed only as used.
const MAX_REPLY_TOKENS = 32768;

export interface AudioScript {
  format: number;
  chapterIdx: number;
  title: string;
  style: FeedStyle;
  language: string;
  paragraphs: string[];
}

const chapterChars = (c: FeedChapter): number =>
  c.text.length || (c.scannedSections?.length ?? 0) * CHARS_PER_SCANNED_PAGE;

/** Words of narration for one chapter: its share of the hour, rounded to 10. */
export const chapterScriptWords = (chapters: FeedChapter[], idx: number): number => {
  const total = chapters.reduce((sum, c) => sum + chapterChars(c), 0);
  const chars = chapterChars(chapters[idx]!);
  if (!total || !chars) return 0;
  const words = Math.min((STORY_WORDS * chars) / total, chars / CHARS_PER_WORD / 2);
  return Math.max(40, Math.round(words / 10) * 10);
};

// What the narration carries, following the book's feed style.
const STYLE_TASKS: Record<FeedStyle, string> = {
  story:
    'Retell it as a story: the key events, decisions and turns of feeling in order, third person, present tense.',
  concepts:
    'Explain its core concepts as a good teacher would aloud: each idea in plain words, why it matters, how it builds on the last. Describe code in words, never read it out.',
  techniques:
    "Walk through the techniques and principles it teaches, with the author's reasoning, key stories and how to apply each one.",
  ideas:
    'Narrate its key ideas, arguments and events in order, with the evidence, examples and people behind them.',
};

const buildPrompt = (
  chapter: FeedChapter,
  segment: string,
  bookTitle: string,
  style: FeedStyle,
  language: string,
  words: number,
  soFar: string,
): string => {
  const lang = feedLanguage(language);
  const sourceWords = Math.round(countWords(segment) / 10) * 10;
  const ratio = Math.max(1, Math.round(sourceWords / words));
  const target =
    lang.code === 'en'
      ? 'English, whatever language the chapter is written in'
      : `${lang.label} (${lang.native}), in its own script, as a fluent narrator of it would speak`;
  return `You are writing an audio story of "${bookTitle}": the book retold as narration
that is read aloud by a voice, chapter by chapter. This is the script for the
chapter "${chapter.title}".

${STYLE_TASKS[style]} Keep what matters most in the text below.

This is a condensed retelling, not a translation. The text below is about
${sourceWords} words; the script is about ${words} words — never more than
${Math.round(words * 1.15)}. That is roughly 1 in ${ratio}: tell what happens and
what matters, summarise dialogue rather than reproducing it line by line, and
leave out description and repetition. Write ${Math.max(1, Math.round(words / PARAGRAPH_WORDS))} paragraphs of 50-90 words each,
exactly 3 sentences per paragraph; a longer paragraph breaks the budget.

It is heard, not read: warm, flowing spoken prose. No headings, lists, markdown, quote marks around whole passages or
LaTeX — say equations and symbols the way a person would aloud. No commentary
about the book, the chapter or the listener; do not greet or sign off.
Write in ${target}. Keep names of people and places as the text gives them.
${
  soFar
    ? `
This continues a script that so far ended with:
"${soFar}"
Carry on from there without restarting or recapping.
`
    : ''
}
Return JSON: {"paragraphs": string[]}.

${segment}`;
};

/** One segment's paragraphs. A reply cut off mid-JSON is retried once, then
 * the segment is skipped: a gap in the story beats a chapter that won't play.
 * A failed request still throws, to be shown. */
const scriptSegment = async (prompt: string): Promise<string[]> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await chatJson<{ paragraphs?: unknown }>(prompt, {
        maxTokens: MAX_REPLY_TOKENS,
      });
      const list = Array.isArray(reply.paragraphs) ? reply.paragraphs : [];
      return list
        .filter((p): p is string => typeof p === 'string' && !!p.trim())
        .map((p) => p.trim());
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
    }
  }
  return [];
};

/** Write one chapter's narration. A long chapter is narrated segment by
 * segment, its words split by length, so the whole of it reaches the model. */
export async function generateChapterScript(
  chapter: FeedChapter,
  bookTitle: string,
  style: FeedStyle,
  language: string,
  words: number,
): Promise<AudioScript> {
  const segments = segmentChapter(chapter.text, MAX_SEGMENT_CHARS);
  const total = segments.reduce((sum, s) => sum + s.length, 0);
  const paragraphs: string[] = [];
  for (const segment of segments) {
    const share = Math.max(40, Math.round((words * segment.length) / total / 10) * 10);
    const prompt = buildPrompt(
      chapter,
      segment,
      bookTitle,
      style,
      language,
      share,
      paragraphs.at(-1) ?? '',
    );
    paragraphs.push(...(await scriptSegment(prompt)));
  }
  return {
    format: AUDIO_FORMAT,
    chapterIdx: chapter.idx,
    title: chapter.title,
    style,
    language,
    paragraphs,
  };
}

/** A cached script still fits: same chapter (by title, as indices can shift),
 * style, language and format, and it has something to say. */
export const isUsableScript = (
  script: AudioScript,
  chapter: FeedChapter,
  style: FeedStyle,
  language: string,
): boolean =>
  script.format === AUDIO_FORMAT &&
  script.title === chapter.title &&
  script.style === style &&
  script.language === language &&
  script.paragraphs.length > 0;
