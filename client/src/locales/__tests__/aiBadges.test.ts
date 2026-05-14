// Slice 3 (decision 33): new i18n keys for the AI ✨ badge tooltip render.
// All three locales must carry both keys with non-empty strings.

import { describe, it, expect } from 'vitest';
import en from '../en';
import nl from '../nl';
import fr from '../fr';

const REQUIRED_KEYS = ['ai_badge_translated', 'ai_badge_improved'] as const;

describe('AI badge i18n keys (slice 3)', () => {
  for (const [name, dict] of [
    ['en', en],
    ['nl', nl],
    ['fr', fr],
  ] as const) {
    describe(`locale ${name}`, () => {
      for (const key of REQUIRED_KEYS) {
        it(`defines ${key}`, () => {
          expect(dict[key]).toBeTruthy();
          expect(typeof dict[key]).toBe('string');
          expect(dict[key].length).toBeGreaterThan(0);
        });
      }
    });
  }

  it('translations are language-distinct (no copy-paste between locales)', () => {
    for (const key of REQUIRED_KEYS) {
      const values = new Set([en[key], nl[key], fr[key]]);
      expect(values.size).toBe(3);
    }
  });
});
