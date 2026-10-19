/**
 * Small rewards: a tick when a card lands, a chime on a key insight, a warmer
 * one when a chapter is done. Haptics go through the Tauri plugin on phones and
 * `navigator.vibrate` elsewhere; the chime is synthesised (no audio files), soft
 * and short. Every call is best-effort — feedback must never break reading.
 */
import {
  impactFeedback,
  notificationFeedback,
  selectionFeedback,
} from '@tauri-apps/plugin-haptics';

export interface FeedbackOptions {
  sound: boolean;
  haptics: boolean;
  // A phone app with the haptics plugin, rather than a browser.
  nativeHaptics: boolean;
}

let audio: AudioContext | null = null;

/** A bell-like tone: sine partials with a quick attack and a long, soft tail. */
const chime = (notes: number[], volume = 0.05) => {
  try {
    audio ??= new AudioContext();
    const start = audio.currentTime + 0.01;
    notes.forEach((freq, i) => {
      for (const [ratio, gain] of [
        [1, 1],
        [2.01, 0.3],
      ] as const) {
        const osc = audio!.createOscillator();
        const env = audio!.createGain();
        const at = start + i * 0.12;
        osc.type = 'sine';
        osc.frequency.value = freq * ratio;
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(volume * gain, at + 0.015);
        env.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
        osc.connect(env).connect(audio!.destination);
        osc.start(at);
        osc.stop(at + 1.5);
      }
    });
  } catch {
    // No audio: silence is fine.
  }
};

const buzz = (options: FeedbackOptions, native: () => Promise<unknown>, pattern: number[]) => {
  if (!options.haptics) return;
  if (options.nativeHaptics) void native().catch(() => {});
  else navigator.vibrate?.(pattern);
};

/** A card snapped into view. */
export const tickFeedback = (options: FeedbackOptions) =>
  buzz(options, () => selectionFeedback(), [6]);

/** A key-insight card arrived. */
export const keyInsightFeedback = (options: FeedbackOptions) => {
  buzz(options, () => impactFeedback('medium'), [14]);
  if (options.sound) chime([880], 0.04);
};

/** The last card of a chapter was reached. */
export const chapterDoneFeedback = (options: FeedbackOptions) => {
  buzz(options, () => notificationFeedback('success'), [10, 60, 18]);
  if (options.sound) chime([659.25, 987.77], 0.05);
};
