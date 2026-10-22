import { describe, expect, test } from 'vitest';

import { isInLanguage, scriptShare } from '@/services/scrollfeed/script';

describe('feed language check (by script)', () => {
  test('tells English from Russian, Thai and Kannada', () => {
    expect(isInLanguage('Alice follows the White Rabbit.', 'en')).toBe(true);
    expect(isInLanguage('Алиса бежит за Белым Кроликом.', 'en')).toBe(false);
    expect(isInLanguage('อลิซวิ่งตามกระต่ายขาว', 'en')).toBe(false);
    expect(isInLanguage('ಆಲಿಸ್ ಬಿಳಿ ಮೊಲವನ್ನು ಹಿಂಬಾಲಿಸುತ್ತಾಳೆ.', 'en')).toBe(false);
    expect(isInLanguage('ಆಲಿಸ್ ಬಿಳಿ ಮೊಲವನ್ನು ಹಿಂಬಾಲಿಸುತ್ತಾಳೆ.', 'kn')).toBe(true);
    expect(isInLanguage('Алиса бежит за Белым Кроликом.', 'ru')).toBe(true);
  });

  test('a few names in another script do not count against it', () => {
    expect(isInLanguage('Natasha meets Pierre at the ball in Москва, then leaves.', 'en')).toBe(
      true,
    );
  });

  test('text without letters, or an unmapped language, passes', () => {
    expect(scriptShare('42 — 7', 'en')).toBe(1);
    expect(scriptShare('anything', 'xx')).toBe(1);
  });
});
