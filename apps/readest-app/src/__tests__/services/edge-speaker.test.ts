import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

type MockAudio = { data: ArrayBuffer; boundaries: never[] };
let resolvers: Array<(v: MockAudio) => void> = [];
const createAudioData = vi.fn(() => new Promise<MockAudio>((resolve) => resolvers.push(resolve)));

vi.mock('@/libs/edgeTTS', () => ({
  EdgeSpeechTTS: class MockEdgeSpeechTTS {
    static voices = [{ id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' }];
    createAudioData = createAudioData;
  },
}));

vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));

import { EdgeSpeaker } from '@/services/tts/aiSpeaker';

const flush = () => new Promise((r) => setTimeout(r, 0));
const audio: MockAudio = { data: new ArrayBuffer(8), boundaries: [] };
// Six sentences each just under the 500-char chunk limit, so the splitter
// emits one chunk per sentence.
const sixChunks = Array.from({ length: 6 }, (_, i) => `${`s${i} `.repeat(110).trim()}.`).join(' ');

let played = 0;

describe('EdgeSpeaker prefetch', () => {
  beforeEach(() => {
    resolvers = [];
    createAudioData.mockClear();
    played = 0;
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    // jsdom has no media pipeline: play() resolves and "ends" on the next
    // macrotask so the speaker advances through its chunks.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      played++;
      setTimeout(() => this.onended?.(new Event('ended')), 0);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // One chunk ahead was the whole reserve: with the screen locked on Android
  // each Edge fetch runs throttled, so a card's later chunks arrived after the
  // earlier ones had finished playing and the voice paused mid-card — the same
  // failure the reader's TTS had. Several chunks must be in flight at once.
  test('opens several synth requests before the first chunk has resolved', async () => {
    const speaker = new EdgeSpeaker();
    void speaker.play(sixChunks);
    await flush();

    expect(createAudioData.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test('still plays every chunk, in order, exactly once', async () => {
    const speaker = new EdgeSpeaker();
    const done = speaker.play(sixChunks);
    for (let i = 0; i < 6; i++) {
      await flush();
      resolvers.shift()?.(audio);
    }
    // Drain any stragglers the prefetch window opened.
    for (let i = 0; i < 6; i++) {
      await flush();
      resolvers.shift()?.(audio);
    }
    await done;

    expect(played).toBe(6);
    expect(createAudioData).toHaveBeenCalledTimes(6);
  });

  test('stop() abandons chunks that were prefetched but not yet played', async () => {
    const speaker = new EdgeSpeaker();
    const done = speaker.play(sixChunks);
    await flush();
    speaker.stop();
    for (const resolve of resolvers.splice(0)) resolve(audio);
    await done;

    expect(played).toBe(0);
  });

  // The audio story speaks a chapter as paragraphs. Played one play() call
  // each, the next paragraph was only requested after the last one ended:
  // a second or two of silence at every paragraph.
  test('playParts prefetches across passages and reports each as it starts', async () => {
    const speaker = new EdgeSpeaker();
    const started: number[] = [];
    const parts = ['First passage.', 'Second passage.', 'Third passage.'];
    const done = speaker.playParts(parts, undefined, 'en', 1, (i) => started.push(i));
    await flush();

    // All three requested before the first has even resolved.
    expect(createAudioData).toHaveBeenCalledTimes(3);

    for (let i = 0; i < 3; i++) {
      resolvers.shift()?.(audio);
      await flush();
      await flush();
    }
    await done;

    expect(started).toEqual([0, 1, 2]);
    expect(played).toBe(3);
  });
});
