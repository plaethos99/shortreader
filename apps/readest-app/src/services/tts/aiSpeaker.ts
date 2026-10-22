// Lightweight Edge-TTS speaker for the AI Insights panel's "Listen" buttons.
//
// The reader's EdgeTTSClient is tied to foliate's SSML/word-highlight pipeline
// and is too heavy for a "read this blob of text" button. This wraps the raw
// EdgeSpeechTTS primitive: synthesize MP3 -> play through an <audio> element,
// chunk-by-chunk with a one-chunk prefetch. It works on every platform:
//   - Web: EdgeSpeechTTS falls back to the /api/tts/edge proxy (anonymous).
//   - Tauri/Android/desktop: EdgeSpeechTTS connects over WSS via TauriWebSocket,
//     which can set the headers browsers can't — so it reaches Microsoft directly.
// This replaces the old Web Speech API path, which threw
// "SpeechSynthesisUtterance is not defined" inside the Android WebView.
import { EdgeSpeechTTS, EDGE_TTS_PROTOCOL } from '@/libs/edgeTTS';
import { isTauriAppPlatform } from '@/services/environment';

const DEFAULT_VOICE = 'en-US-AriaNeural';
// Edge accepts long inputs, but shorter chunks start playback sooner and keep
// the prefetch pipeline responsive to stop().
const MAX_CHUNK = 500;
// Chunks kept synthesizing ahead of the one playing (see play()).
const PREFETCH_AHEAD = 3;

const splitIntoChunks = (text: string): string[] => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > MAX_CHUNK) {
      // A single over-long sentence: flush, then hard-split it.
      if (cur.trim()) chunks.push(cur.trim());
      cur = '';
      for (let i = 0; i < s.length; i += MAX_CHUNK) chunks.push(s.slice(i, i + MAX_CHUNK).trim());
      continue;
    }
    if (cur.length + s.length > MAX_CHUNK && cur.trim()) {
      chunks.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
};

export class EdgeSpeaker {
  #tts: EdgeSpeechTTS | null = null;
  #audio: HTMLAudioElement | null = null;
  // Monotonic session token: every stop()/play() bumps it so any in-flight
  // synth or queued chunk from an older session is discarded.
  #token = 0;
  #protocol: EDGE_TTS_PROTOCOL = isTauriAppPlatform() ? 'wss' : 'https';

  get playing(): boolean {
    return !!this.#audio && !this.#audio.paused;
  }

  play(text: string, voiceId?: string, lang = 'en', rate = 1): Promise<void> {
    return this.playParts([text], voiceId, lang, rate);
  }

  /** Several passages back to back, with no gap between them: synthesis runs
   * ahead across passage boundaries, as it does within one. `onPart(i)` fires
   * as passage i starts playing. */
  async playParts(
    parts: string[],
    voiceId?: string,
    lang = 'en',
    rate = 1,
    onPart?: (index: number) => void,
  ): Promise<void> {
    this.stop();
    const token = ++this.#token;
    if (!this.#tts) this.#tts = new EdgeSpeechTTS(this.#protocol);
    const tts = this.#tts;
    const voice = voiceId || DEFAULT_VOICE;
    const pieces = parts.flatMap((part, index) =>
      splitIntoChunks(part).map((chunk, k) => ({ chunk, index, first: k === 0 })),
    );
    const chunks = pieces.map((p) => p.chunk);
    if (!chunks.length) return;

    // Rate is sent to Edge rather than applied as playbackRate on the <audio>
    // element: Edge re-synthesizes at speed, which keeps the pitch natural,
    // where element playbackRate chipmunks the voice.
    const synth = (chunk: string) =>
      tts.createAudioData({ lang, text: chunk, voice, rate, pitch: 1 });

    // Keep PREFETCH_AHEAD chunks synthesizing ahead of the one playing. One
    // ahead was the whole reserve, and with the screen locked on Android each
    // Edge fetch runs throttled: later chunks arrived after the earlier ones
    // had finished and the voice paused mid-text. A window of a few keeps the
    // network off the playback path without opening a socket per chunk of a
    // long AI-panel passage all at once.
    const synths: Array<Promise<{ data: ArrayBuffer }>> = [];
    const ensureStarted = (j: number) => {
      if (j >= chunks.length || synths[j]) return;
      const p = synth(chunks[j]!);
      // A prefetched chunk may be abandoned by stop() before it is awaited;
      // its rejection must not surface as unhandled. The await below still
      // sees the real error.
      p.catch(() => {});
      synths[j] = p;
    };
    for (let i = 0; i < chunks.length; i++) {
      if (token !== this.#token) return;
      for (let j = i; j < i + PREFETCH_AHEAD; j++) ensureStarted(j);
      const audio = await synths[i]!;
      if (token !== this.#token) return;
      if (pieces[i]!.first) onPart?.(pieces[i]!.index);
      await this.#playBuffer(audio.data, token);
    }
  }

  #playBuffer(data: ArrayBuffer, token: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (token !== this.#token) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(new Blob([data], { type: 'audio/mpeg' }));
      const el = new Audio();
      el.src = url;
      this.#audio = el;
      const cleanup = () => URL.revokeObjectURL(url);
      el.onended = () => {
        cleanup();
        resolve();
      };
      el.onerror = () => {
        cleanup();
        reject(new Error('Audio playback failed'));
      };
      el.play().catch((e) => {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  /**
   * Fetch a passage's first few pieces of audio ahead of playing it, so it
   * starts at once when its turn comes. Synthesis is cached and in-flight
   * requests are shared (EdgeSpeechTTS), so playing it later reuses this work
   * rather than repeating it. Failures are ignored: playback retries.
   */
  prefetch(text: string, voiceId?: string, lang = 'en', rate = 1): void {
    if (!this.#tts) this.#tts = new EdgeSpeechTTS(this.#protocol);
    const tts = this.#tts;
    const voice = voiceId || DEFAULT_VOICE;
    for (const chunk of splitIntoChunks(text).slice(0, PREFETCH_AHEAD)) {
      tts.createAudioData({ lang, text: chunk, voice, rate, pitch: 1 }).catch(() => {});
    }
  }

  stop(): void {
    this.#token++;
    if (this.#audio) {
      try {
        this.#audio.pause();
      } catch {
        /* noop */
      }
      this.#audio.src = '';
      this.#audio = null;
    }
  }
}
