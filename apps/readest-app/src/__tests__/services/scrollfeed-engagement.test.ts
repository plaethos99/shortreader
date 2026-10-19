import { describe, expect, test } from 'vitest';

import {
  dayKey,
  minutesThisWeek,
  readingStreak,
  recordReading,
  type ReadingStats,
} from '@/services/scrollfeed/engagement';

const day = (iso: string) => new Date(`${iso}T12:00:00`);

describe('recordReading', () => {
  test('adds seconds to the day, returning new stats', () => {
    const before: ReadingStats = { days: { '2026-09-21': 30 } };
    const after = recordReading(before, day('2026-09-21'), 45);

    expect(after.days['2026-09-21']).toBe(75);
    expect(before.days['2026-09-21']).toBe(30);
  });

  test('ignores nonsense durations', () => {
    const stats = { days: {} };
    expect(recordReading(stats, day('2026-09-21'), -5)).toBe(stats);
    expect(recordReading(stats, day('2026-09-21'), Number.NaN)).toBe(stats);
  });

  test('keeps only the last 60 days', () => {
    let stats: ReadingStats = { days: {} };
    for (let i = 0; i < 70; i++) {
      stats = recordReading(stats, new Date(2026, 0, 1 + i, 12), 60);
    }
    expect(Object.keys(stats.days)).toHaveLength(60);
  });
});

describe('readingStreak', () => {
  // A day counts once a minute of it was spent reading.
  const stats: ReadingStats = {
    days: { '2026-09-19': 120, '2026-09-20': 61, '2026-09-21': 300, '2026-09-17': 900 },
  };

  test('counts consecutive reading days up to today', () => {
    expect(readingStreak(stats, day('2026-09-21'))).toBe(3);
  });

  test('a streak survives until today is over', () => {
    expect(readingStreak(stats, day('2026-09-22'))).toBe(3);
  });

  test('a missed day ends it', () => {
    expect(readingStreak(stats, day('2026-09-23'))).toBe(0);
  });

  test('under a minute does not count', () => {
    expect(readingStreak({ days: { '2026-09-21': 20 } }, day('2026-09-21'))).toBe(0);
  });
});

describe('minutesThisWeek', () => {
  test('sums the last seven days, rounded to minutes', () => {
    const stats: ReadingStats = {
      days: { '2026-09-21': 600, '2026-09-16': 330, '2026-09-10': 6000 },
    };
    expect(minutesThisWeek(stats, day('2026-09-21'))).toBe(16);
  });
});

test('dayKey is the local calendar date', () => {
  expect(dayKey(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05');
});
