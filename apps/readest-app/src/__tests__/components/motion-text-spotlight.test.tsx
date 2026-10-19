import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import MotionText from '@/app/reader/components/ambience/MotionText';

const TEXT = 'Kirill has worked on it for a year. Red does not understand. One thing is clear.';

const opacity = (text: string) =>
  Number((screen.getByText(text).closest('[data-sentence]') as HTMLElement).style.opacity);

describe('MotionText spotlight', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // A reader who fell behind must still be able to read what the light
  // already passed: it stays readable instead of dimming back down.
  test('sentences already passed stay readable, upcoming ones are dimmed', () => {
    render(<MotionText text={TEXT} motion='spot' active />);
    act(() => vi.advanceTimersByTime(2600));

    expect(opacity('Kirill has worked on it for a year.')).toBeGreaterThanOrEqual(0.75);
    expect(opacity('Red does not understand.')).toBe(1);
    expect(opacity('One thing is clear.')).toBeLessThan(0.5);
  });

  test('tapping a sentence moves the spotlight there and carries on from it', () => {
    render(<MotionText text={TEXT} motion='spot' active />);
    act(() => vi.advanceTimersByTime(7000));
    // Past the end: everything is at full brightness.
    expect(opacity('Kirill has worked on it for a year.')).toBe(1);

    fireEvent.click(screen.getByText('Kirill has worked on it for a year.'));

    expect(opacity('Kirill has worked on it for a year.')).toBe(1);
    expect(opacity('One thing is clear.')).toBeLessThan(0.5);
    act(() => vi.advanceTimersByTime(2600));
    expect(opacity('Red does not understand.')).toBe(1);
  });

  // Slow enough to read in a second language: a short sentence still gets
  // at least two seconds.
  test('holds even a short sentence for at least two seconds', () => {
    render(<MotionText text='Yes. No. Maybe.' motion='spot' active />);
    act(() => vi.advanceTimersByTime(1900));

    expect(opacity('Yes.')).toBe(1);
    expect(opacity('No.')).toBeLessThan(0.5);
  });
});
