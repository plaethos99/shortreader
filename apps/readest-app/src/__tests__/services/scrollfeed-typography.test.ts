import { describe, expect, test } from 'vitest';

import { storySizeClass } from '@/services/scrollfeed/typography';

describe('storySizeClass', () => {
  // A card is one paragraph of the retelling, 80-130 words (~450-800 chars).
  // One fixed size left short paragraphs floating and pushed long ones under
  // the feed's controls; the size steps down with length so every card fills
  // roughly the same space.
  test('a typical paragraph gets reading size, not headline size', () => {
    expect(storySizeClass('x'.repeat(600))).toBe('text-lg sm:text-xl');
  });

  test('size steps down monotonically with length', () => {
    const sizes = [300, 600, 1000].map((n) => storySizeClass('x'.repeat(n)));
    expect(new Set(sizes).size).toBe(3);
  });

  test('very long paragraphs bottom out at a readable minimum', () => {
    expect(storySizeClass('x'.repeat(5000))).toBe(storySizeClass('x'.repeat(1000)));
    expect(storySizeClass('x'.repeat(5000))).toMatch(/text-base/);
  });
});
