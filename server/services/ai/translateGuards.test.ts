import { describe, it, expect } from 'vitest';
import { shouldSkipTranslation } from './translateGuards.js';

describe('shouldSkipTranslation', () => {
  it('skips empty string', () => {
    expect(shouldSkipTranslation('')).toBe(true);
  });

  it('skips whitespace-only input', () => {
    expect(shouldSkipTranslation('   \n\t')).toBe(true);
  });

  it('skips digits-only input — the case that triggered AI meta-refusals', () => {
    expect(shouldSkipTranslation('5555555555555555555555555555')).toBe(true);
  });

  it('skips punctuation-only input', () => {
    expect(shouldSkipTranslation('!!!???...')).toBe(true);
  });

  it('skips emoji-only input', () => {
    expect(shouldSkipTranslation('🚀🚀🚀')).toBe(true);
  });

  it('skips arithmetic-style input with no letters', () => {
    expect(shouldSkipTranslation('2 + 2 = 4')).toBe(true);
  });

  it('translates regular ASCII letters', () => {
    expect(shouldSkipTranslation('hello')).toBe(false);
  });

  it('translates accented Latin letters', () => {
    expect(shouldSkipTranslation('café')).toBe(false);
  });

  it('translates non-Latin scripts (Cyrillic, CJK, Arabic, etc.)', () => {
    expect(shouldSkipTranslation('привет')).toBe(false);
    expect(shouldSkipTranslation('你好')).toBe(false);
    expect(shouldSkipTranslation('مرحبا')).toBe(false);
  });

  it('translates mixed input that contains at least one letter', () => {
    expect(shouldSkipTranslation('order #12345')).toBe(false);
    expect(shouldSkipTranslation('ok 123')).toBe(false);
  });
});
