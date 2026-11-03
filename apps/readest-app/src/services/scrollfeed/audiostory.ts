/**
 * Audio story: the whole book retold as narration — listened to, not read.
 *
 * Each chapter keeps the feed's share of its length, and its script is written
 * on demand, like the feed's cards: a book with hundreds of TOC entries can't be
 * scripted in one pass before the first word is heard. It used to be an hour
 * for the whole book, whatever its size, which left a long book's chapter a few
 * minutes: 3-15% of the text, with its dialogue and description cut.
 */
import { chatJson } from '../llm';
import { checkRetelling, countWords, RETELLING_RATIO, retellingCorrection } from './cards';
import type { FeedChapter } from './chapters';
import type { FeedStyle } from './genre';
import { feedLanguage } from './language';
import { isInLanguage } from './script';
import { segmentChapter } from './segments';

// Bump when the script shape or prompt changes enough to discard cached ones.
// v2: condensed, not translated (v1 scripts of foreign books ran ~6x long).
// v3: half of each chapter, with its voice (v2 was an hour for the whole book).
// v4: told in the narrator's own sentences (v3 read much of the book back out).
export const AUDIO_FORMAT = 4;

// A narrator's pace: Edge voices at 1x read prose at ~150 words a minute.
export const WORDS_PER_MINUTE = 150;
// A scanned chapter has no text until its pages are read; a page is about this.
const WORDS_PER_SCANNED_PAGE = 330;
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

/** Words of narration for one chapter, rounded to 10. */
export const chapterScriptWords = (chapter: FeedChapter): number => {
  const words =
    countWords(chapter.text) || (chapter.scannedSections?.length ?? 0) * WORDS_PER_SCANNED_PAGE;
  if (!words) return 0;
  return Math.max(40, Math.round((words * RETELLING_RATIO) / 10) * 10);
};

// What the narration carries, following the book's feed style.
const STYLE_TASKS: Record<FeedStyle, string> = {
  story:
    "Retell it as a story, in the book's own point of view: every event, decision and turn of feeling in order, with the reasons behind them and the book's mood and humour.",
  concepts:
    "Explain its core concepts as a good teacher would aloud: each idea in plain words, the author's reasoning, why it matters, how it builds on the last. Describe code in words, never read it out.",
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
  insistOnLanguage = false,
  correction = '',
): string => {
  const lang = feedLanguage(language);
  const sourceWords = Math.round(countWords(segment) / 10) * 10;
  const ceiling = Math.round((words * 1.25) / 10) * 10;
  const target =
    lang.code === 'en'
      ? 'English, whatever language the chapter is written in'
      : `${lang.label} (${lang.native}), in its own script, as a fluent narrator of it would speak`;
  return `You are writing an audio story of "${bookTitle}": the book retold as narration
that is read aloud by a voice, chapter by chapter. This is the script for the
chapter "${chapter.title}".

${STYLE_TASKS[style]} A listener who hears only this should miss nothing important in the text below.

This is a condensed retelling in your own sentences: not a translation, and not
the book read out. The text below is about
${sourceWords} words; the script is about ${words} words, never more than ${ceiling}:
shorter loses the chapter, longer is just the book again. Gather several of the
book's sentences into one of your own; never copy them, lightly edit them or
translate them one by one. Keep every scene, motive and argument and the images
and examples the author dwells on. Report most conversation in narration, and let
only the line or two that count be heard as speech.
Write ${Math.max(1, Math.round(words / PARAGRAPH_WORDS))} paragraphs of 50-90 words each.

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

${segment}${correction && `\n\n${correction}`}${
  // Repeated after the chapter: given a long chapter in another language,
  // the model drifts back into it.
  insistOnLanguage
    ? `

IMPORTANT: your previous script was not in ${lang.label}. Write every paragraph in ${lang.label} — the chapter's own language is only what you read, not what you write.`
    : `

Remember: write every paragraph in ${lang.label}.`
}`;
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
    const prompt = (insist: boolean, correction = '') =>
      buildPrompt(
        chapter,
        segment,
        bookTitle,
        style,
        language,
        share,
        paragraphs.at(-1) ?? '',
        insist,
        correction,
      );
    let written = await scriptSegment(prompt(false));
    // Narrated in the chapter's language instead of the chosen one: once more, firmly.
    if (written.length && !isInLanguage(written.join(' '), language)) {
      const retry = await scriptSegment(prompt(true));
      if (retry.length && isInLanguage(retry.join(' '), language)) written = retry;
    }
    // Complete but too short, too long or copied: told so once, and the closer
    // of the two stands. An empty reply has had its retry, and a failed retry
    // doesn't cost the script already in hand.
    const first = checkRetelling(written.join(' '), segment, share);
    if (written.length && first.problem) {
      const correction = retellingCorrection(first, share, 'script');
      const retry = await scriptSegment(prompt(false, correction)).catch(() => []);
      const text = retry.join(' ');
      if (
        retry.length &&
        isInLanguage(text, language) &&
        checkRetelling(text, segment, share).miss < first.miss
      ) {
        written = retry;
      }
    }
    paragraphs.push(...written);
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
