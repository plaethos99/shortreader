/**
 * "Read all": the whole book's curated cards, every chapter, as ONE
 * continuous recording.
 *
 * Read-along speaks card by card, which needs the app's JavaScript between
 * cards — and a locked phone or a minimized window throttles exactly that, so
 * playback paused. One recording plays end to end in the player itself (the
 * native player on phones, an audio element on desktop) with nothing to do in
 * between. Each chapter opens with its title, and where it starts is known,
 * for the chapter list and next / previous chapter.
 */
import { splitIntoChunks } from '@/services/tts/aiSpeaker';

import { feedLanguage } from './language';
import { spokenText } from './playback';
import { isInLanguage } from './script';
import type { ChapterFeed } from './types';

// Edge read-aloud audio is constant-bitrate MP3 (audio-24khz-48kbitrate-mono-mp3),
// so a byte offset is a time: 48 kbit/s = 6000 bytes a second.
export const BYTES_PER_SECOND = 6000;

export interface BookSection {
  chapterIdx: number;
  title: string;
  // What is read aloud, in order: the chapter's heading, then its cards.
  parts: string[];
}

export interface BookAudioChapter {
  chapterIdx: number;
  title: string;
  startSec: number;
}

export interface BookAudio {
  blob: Blob;
  chapters: BookAudioChapter[];
  durationSec: number;
}

/** The spoken heading of a chapter: "Chapter 3. Title." in English. In other
 * languages, or for a title in another language than the cards, only what the
 * voice can say well. */
export const chapterHeading = (number: number, title: string, language: string): string => {
  const titleFits = title.trim() && isInLanguage(title, language);
  if (feedLanguage(language).code === 'en') {
    return titleFits ? `Chapter ${number}. ${title.trim()}.` : `Chapter ${number}.`;
  }
  return titleFits ? `${title.trim()}.` : `${number}.`;
};

/** The book as spoken sections, one per chapter with cards. */
export const bookSections = (feeds: ChapterFeed[], language: string): BookSection[] =>
  feeds
    .filter((feed) => feed.cards.length > 0)
    .map((feed, i) => ({
      chapterIdx: feed.chapterIdx,
      title: feed.title,
      parts: [chapterHeading(i + 1, feed.title, language), ...feed.cards.map(spokenText)],
    }));

export interface SynthesizeOptions {
  // One piece of text to MP3 bytes (Edge read-aloud).
  synth: (text: string) => Promise<ArrayBuffer>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  concurrency?: number;
}

/** Speak every section into one MP3, in order, and note where each chapter
 * starts. Pieces are made a few at a time; the result keeps reading order. */
export async function synthesizeBookAudio(
  sections: BookSection[],
  { synth, onProgress, signal, concurrency = 4 }: SynthesizeOptions,
): Promise<BookAudio> {
  const pieces = sections.flatMap((section, s) =>
    section.parts.flatMap((part) => splitIntoChunks(part).map((text) => ({ text, section: s }))),
  );
  const audio: ArrayBuffer[] = new Array(pieces.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < pieces.length) {
      if (signal?.aborted) throw new Error('Cancelled');
      const i = next++;
      audio[i] = await synth(pieces[i]!.text);
      onProgress?.(++done, pieces.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pieces.length) }, worker));

  const chapters: BookAudioChapter[] = [];
  let bytes = 0;
  pieces.forEach((piece, i) => {
    const section = sections[piece.section]!;
    if (chapters.at(-1)?.chapterIdx !== section.chapterIdx) {
      chapters.push({
        chapterIdx: section.chapterIdx,
        title: section.title,
        startSec: bytes / BYTES_PER_SECOND,
      });
    }
    bytes += audio[i]!.byteLength;
  });
  return {
    // MP3 is a stream of self-contained frames: pieces join end to end.
    blob: new Blob(audio, { type: 'audio/mpeg' }),
    chapters,
    durationSec: bytes / BYTES_PER_SECOND,
  };
}

/** The chapter playing at `seconds`. */
export const chapterAt = (chapters: BookAudioChapter[], seconds: number): number => {
  let current = 0;
  chapters.forEach((chapter, i) => {
    if (chapter.startSec <= seconds + 0.01) current = i;
  });
  return current;
};
