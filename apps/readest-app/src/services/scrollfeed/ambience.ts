/**
 * The feel of the feed and focus mode: how text arrives, what moves behind it,
 * and the colours it takes from the book.
 *
 * Pure data and functions only; the canvas renderer (AmbientBackground) and
 * the card animation (MotionText) read these. Backgrounds tint the reader's own
 * theme colour rather than replacing it, so text contrast holds in light and
 * dark themes alike.
 */

export type TextMotion = 'rise' | 'cascade' | 'bloom' | 'ink' | 'spot';
export type Backdrop = 'plain' | 'aurora' | 'breathe' | 'grain' | 'motes' | 'waves' | 'focus';
export type FeedMood =
  | 'calm'
  | 'scifi'
  | 'fantasy'
  | 'romance'
  | 'mystery'
  | 'nature'
  | 'history'
  | 'growth'
  | 'tech';

export const TEXT_MOTIONS: { id: TextMotion; label: string }[] = [
  { id: 'rise', label: 'Rise' },
  { id: 'cascade', label: 'Sentence cascade' },
  { id: 'bloom', label: 'Word bloom' },
  { id: 'ink', label: 'Ink sweep' },
  { id: 'spot', label: 'Spotlight' },
];

// Plain first: it is what e-ink and "reduce motion" fall back to.
export const BACKDROPS: { id: Backdrop; label: string }[] = [
  { id: 'plain', label: 'Plain' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'breathe', label: 'Breathing glow' },
  { id: 'grain', label: 'Paper grain' },
  { id: 'motes', label: 'Drifting motes' },
  { id: 'waves', label: 'Ink waves' },
  { id: 'focus', label: 'Focus black' },
];

const PALETTES: Record<FeedMood, [string, string, string]> = {
  calm: ['#2a3b5a', '#3b5a5a', '#4b3a5a'],
  scifi: ['#1b2a6b', '#0e7c9a', '#4b3a9e'],
  fantasy: ['#4b2a7a', '#9a6a1e', '#2a4b7a'],
  romance: ['#7a2a4b', '#a8563e', '#5a2a6b'],
  mystery: ['#0f3b3b', '#5c1a1a', '#1d2b45'],
  nature: ['#1f5a2e', '#4b6b1e', '#0f4b4b'],
  history: ['#5a3d1e', '#7a5a2a', '#3d2a1e'],
  growth: ['#8a4b1e', '#7a2a4b', '#1e5a6b'],
  tech: ['#123a5a', '#1e4b6b', '#2a2a5a'],
};

export const FEED_MOODS: { id: FeedMood; label: string }[] = [
  { id: 'calm', label: 'Calm' },
  { id: 'scifi', label: 'Sci-fi' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'romance', label: 'Romance' },
  { id: 'mystery', label: 'Mystery' },
  { id: 'nature', label: 'Nature' },
  { id: 'history', label: 'History' },
  { id: 'growth', label: 'Self-help' },
  { id: 'tech', label: 'Technical' },
];

export const toMood = (value: unknown): FeedMood =>
  typeof value === 'string' && value in PALETTES ? (value as FeedMood) : 'calm';

export const moodPalette = (mood: FeedMood): [string, string, string] => PALETTES[toMood(mood)];

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]: number[]): string =>
  `#${[r, g, b].map((v) => Math.round(v!).toString(16).padStart(2, '0')).join('')}`;

/** The mood's palette pulled `amount` of the way toward the cover's colours,
 * colour by colour, so each book looks its own within its mood. */
export const blendPalette = (palette: string[], cover: string[], amount = 0.4): string[] =>
  palette.map((color, i) => {
    const target = cover[i];
    if (!target) return color;
    const a = toRgb(color);
    const b = toRgb(target);
    return toHex(a.map((v, k) => v + (b[k]! - v) * amount));
  });

/**
 * The most common clearly-coloured colours in an image's RGBA pixels, most
 * common first. Near-white margins, black, and greys are skipped: they say
 * nothing about the book. Colours are bucketed at 4 bits per channel.
 */
export const dominantColors = (data: Uint8ClampedArray, count = 3): string[] => {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (data[i + 3]! < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40 || min > 225 || max - min < 40) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    buckets.set(key, { n: bucket.n + 1, r: bucket.r + r, g: bucket.g + g, b: bucket.b + b });
  }
  return [...buckets.values()]
    .sort((x, y) => y.n - x.n)
    .slice(0, count)
    .map((b) => toHex([b.r / b.n, b.g / b.n, b.b / b.n]));
};

// Math is kept whole: a sentence or word split inside $...$ breaks the LaTeX.
const MATH = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;

// Math spans are swapped for numbered private-use markers while splitting.
const MARK = String.fromCharCode(0xe000);
const MARKED = new RegExp(`${MARK}([0-9]+)${MARK}`, 'g');

const protectMath = (text: string): { masked: string; restore: (s: string) => string } => {
  const found: string[] = [];
  const masked = text.replace(MATH, (m) => `${MARK}${found.push(m) - 1}${MARK}`);
  const restore = (s: string) => s.replace(MARKED, (_, i) => found[Number(i)]!);
  return { masked, restore };
};

/** Sentences, each with its closing punctuation (Latin, CJK and Devanagari). */
export const splitSentences = (text: string): string[] => {
  const { masked, restore } = protectMath(text.trim());
  return (masked.match(/[^.!?。！？।]+[.!?。！？।]*[”’"')\]]*\s*/g) ?? [masked])
    .map((s) => restore(s).trim())
    .filter(Boolean);
};

/** Words and the spaces between them, math kept whole; joins back exactly. */
export const splitWords = (text: string): string[] => {
  const { masked, restore } = protectMath(text);
  return (masked.match(/\s+|\S+/g) ?? []).map(restore);
};
