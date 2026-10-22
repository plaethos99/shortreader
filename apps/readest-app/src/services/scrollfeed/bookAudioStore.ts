/**
 * A finished "Read all" recording, kept in the app's cache folder (desktop and
 * phone apps) so opening the book again plays at once instead of recording
 * the whole book again. The web app keeps it for the session only.
 */
import { isTauriAppPlatform } from '@/services/environment';

import type { BookAudio, BookAudioChapter } from './bookAudio';

interface Saved {
  key: string;
  chapters: BookAudioChapter[];
  durationSec: number;
}

const paths = async (bookHash: string) => {
  const { appCacheDir, join } = await import('@tauri-apps/api/path');
  const dir = await join(await appCacheDir(), 'read-all');
  return {
    dir,
    audio: await join(dir, `${bookHash}.mp3`),
    meta: await join(dir, `${bookHash}.json`),
  };
};

/** What a recording was made from: when any of it changes, record again. */
export const recordingKey = (parts: {
  language: string;
  style: string;
  voiceId: string;
  chapters: { idx: number; title: string }[];
}): string =>
  JSON.stringify([
    parts.language,
    parts.style,
    parts.voiceId,
    parts.chapters.map((c) => `${c.idx}:${c.title}`),
  ]);

export async function saveRecording(bookHash: string, key: string, audio: BookAudio) {
  if (!isTauriAppPlatform()) return;
  const { mkdir, writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');
  const p = await paths(bookHash);
  await mkdir(p.dir, { recursive: true });
  await writeFile(p.audio, new Uint8Array(await audio.blob.arrayBuffer()));
  const saved: Saved = { key, chapters: audio.chapters, durationSec: audio.durationSec };
  await writeTextFile(p.meta, JSON.stringify(saved));
}

export async function loadRecording(bookHash: string, key: string): Promise<BookAudio | null> {
  if (!isTauriAppPlatform()) return null;
  try {
    const { exists, readFile, readTextFile } = await import('@tauri-apps/plugin-fs');
    const p = await paths(bookHash);
    if (!(await exists(p.meta)) || !(await exists(p.audio))) return null;
    const saved = JSON.parse(await readTextFile(p.meta)) as Saved;
    if (saved.key !== key) return null;
    const bytes = await readFile(p.audio);
    return {
      blob: new Blob([bytes], { type: 'audio/mpeg' }),
      chapters: saved.chapters,
      durationSec: saved.durationSec,
    };
  } catch {
    return null;
  }
}
