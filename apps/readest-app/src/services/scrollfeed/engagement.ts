/**
 * Reading streak and minutes read — the feed's quiet sense of progress.
 *
 * Counted from time actually spent on a card with the app in view, never from
 * opening the app: the reward follows reading. Stats are per day, local
 * calendar, and kept for 60 days.
 */

export interface ReadingStats {
  // 'YYYY-MM-DD' -> seconds read that day.
  days: Record<string, number>;
}

const KEEP_DAYS = 60;
// A day joins the streak once this much of it was spent reading.
const STREAK_DAY_SECONDS = 60;

export const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const shift = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

/** Stats with `seconds` more read on `date`'s day. */
export const recordReading = (stats: ReadingStats, date: Date, seconds: number): ReadingStats => {
  if (!Number.isFinite(seconds) || seconds <= 0) return stats;
  const key = dayKey(date);
  const days = { ...stats.days, [key]: (stats.days[key] ?? 0) + seconds };
  const kept = Object.keys(days).sort().slice(-KEEP_DAYS);
  return { days: Object.fromEntries(kept.map((k) => [k, days[k]!])) };
};

/** Consecutive reading days ending today — or yesterday, since today may
 * not have been read yet. */
export const readingStreak = (stats: ReadingStats, today: Date): number => {
  const read = (date: Date) => (stats.days[dayKey(date)] ?? 0) >= STREAK_DAY_SECONDS;
  let cursor = read(today) ? today : shift(today, -1);
  let streak = 0;
  while (read(cursor)) {
    streak++;
    cursor = shift(cursor, -1);
  }
  return streak;
};

export const minutesThisWeek = (stats: ReadingStats, today: Date): number => {
  let seconds = 0;
  for (let i = 0; i < 7; i++) seconds += stats.days[dayKey(shift(today, -i))] ?? 0;
  return Math.round(seconds / 60);
};
