/**
 * Plays a "Read all" recording (bookAudio.ts) so it keeps going with the
 * phone locked or the window minimized:
 *
 * - phones: written to the app's cache folder and played by the native player
 *   (ExoPlayer / AVPlayer, the audiobook player), under the media-playback
 *   session that keeps the app alive with the screen off and puts play/pause
 *   and next/previous chapter on the lock screen;
 * - desktop and web: one audio element, which plays on when the window is
 *   minimized, with the system media keys.
 */
import { HtmlAudioClock, type AudiobookClock } from '@/services/audiobook/AudiobookClock';
import { NativeAudiobookClock } from '@/services/audiobook/NativeAudiobookClock';
import { isTauriAppPlatform } from '@/services/environment';
import { getMediaSession, type TauriMediaSession } from '@/libs/mediaSession';
import { getOSPlatform } from '@/utils/misc';

import { chapterAt, type BookAudio } from './bookAudio';

type Session = ReturnType<typeof getMediaSession>;

export interface BookAudioHandlers {
  onEnded?: () => void;
}

const isNativeSession = (session: Session): session is TauriMediaSession =>
  !!session && 'setActive' in session;

export class BookAudioPlayer {
  #native = isTauriAppPlatform() && ['android', 'ios'].includes(getOSPlatform());
  #clock: AudiobookClock = this.#native ? new NativeAudiobookClock() : new HtmlAudioClock();
  #url: string | null = null;
  #session: Session = null;
  #audio: BookAudio | null = null;
  #bookTitle = '';
  #chapter = -1;

  get currentTime(): number {
    return this.#clock.currentTime;
  }

  get paused(): boolean {
    return this.#clock.paused;
  }

  get chapterIndex(): number {
    return this.#audio ? chapterAt(this.#audio.chapters, this.currentTime) : 0;
  }

  async load(
    audio: BookAudio,
    bookHash: string,
    bookTitle: string,
    handlers: BookAudioHandlers = {},
  ) {
    this.#audio = audio;
    this.#bookTitle = bookTitle;
    if (this.#native) {
      const { appCacheDir, join } = await import('@tauri-apps/api/path');
      const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');
      const dir = await join(await appCacheDir(), 'read-all');
      await mkdir(dir, { recursive: true });
      const path = await join(dir, `${bookHash}.mp3`);
      await writeFile(path, new Uint8Array(await audio.blob.arrayBuffer()));
      await this.#clock.load(path, 0);
    } else {
      this.#url = URL.createObjectURL(audio.blob);
      await this.#clock.load(this.#url, 0);
    }
    this.#clock.addEventListener('ended', () => {
      void this.#setPlaybackState(false);
      handlers.onEnded?.();
    });
    await this.#startSession();
  }

  async play() {
    await this.#clock.play();
    await this.#setPlaybackState(true);
  }

  pause() {
    this.#clock.pause();
    void this.#setPlaybackState(false);
  }

  async seek(seconds: number) {
    if (this.#native) await (this.#clock as NativeAudiobookClock).seek(seconds);
    else this.#clock.currentTime = seconds;
    this.syncChapter();
  }

  async goToChapter(index: number) {
    const chapter = this.#audio?.chapters[index];
    if (chapter) await this.seek(chapter.startSec);
  }

  setRate(rate: number) {
    this.#clock.playbackRate = rate;
  }

  /** Call now and then while playing: names the current chapter on the lock
   * screen / media controls when it changes. */
  syncChapter() {
    const index = this.chapterIndex;
    if (index === this.#chapter || !this.#audio) return;
    this.#chapter = index;
    const title = this.#audio.chapters[index]?.title ?? '';
    const session = this.#session;
    if (isNativeSession(session)) {
      void session.updateMetadata({ title, artist: this.#bookTitle, album: this.#bookTitle });
    } else if (session && typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({
        title,
        artist: this.#bookTitle,
        album: this.#bookTitle,
      });
    }
  }

  async #startSession() {
    const session = getMediaSession();
    this.#session = session;
    if (!session) return;
    const toggle = () => (this.paused ? void this.play() : this.pause());
    const handlers: Record<string, () => void> = {
      play: () => void this.play(),
      pause: () => this.pause(),
      toggle,
      nexttrack: () => void this.goToChapter(this.chapterIndex + 1),
      previoustrack: () => void this.goToChapter(Math.max(0, this.chapterIndex - 1)),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        // An action this platform's media session doesn't have.
      }
    }
    if (isNativeSession(session)) {
      await session.setActive({
        active: true,
        // The native player renders this audio itself, so the media service
        // holds audio focus (see MediaSessionState.ownsAudioFocus).
        ownsAudioFocus: this.#native,
        notificationTitle: this.#bookTitle,
        notificationText: 'Read all',
        foregroundServiceTitle: this.#bookTitle,
        foregroundServiceText: 'Reading the curated book aloud',
        bookTitle: this.#bookTitle,
      });
    }
    this.#chapter = -1;
    this.syncChapter();
  }

  async #setPlaybackState(playing: boolean) {
    const session = this.#session;
    if (isNativeSession(session)) {
      await session.updatePlaybackState({
        playing,
        position: this.currentTime * 1000,
        duration: (this.#audio?.durationSec ?? 0) * 1000,
      });
    } else if (session) {
      session.playbackState = playing ? 'playing' : 'paused';
    }
  }

  destroy() {
    this.#clock.destroy();
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = null;
    const session = this.#session;
    if (isNativeSession(session)) void session.setActive({ active: false });
    else if (session) {
      for (const action of ['play', 'pause', 'nexttrack', 'previoustrack'] as const) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Not supported here.
        }
      }
    }
    this.#session = null;
  }
}
