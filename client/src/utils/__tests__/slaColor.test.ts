import { describe, it, expect } from 'vitest';
import { slaColor } from '../slaColor';

describe('slaColor', () => {
  it('returns neutral when target is null', () => {
    expect(slaColor(95, null, 5)).toBe('neutral');
  });

  it('returns neutral when actual is null (no closed tickets yet)', () => {
    expect(slaColor(null, 95, 5)).toBe('neutral');
  });

  it('returns green when actual exactly meets target', () => {
    expect(slaColor(95, 95, 5)).toBe('green');
  });

  it('returns green when actual exceeds target', () => {
    expect(slaColor(98, 95, 5)).toBe('green');
  });

  it('returns amber just below target', () => {
    expect(slaColor(94, 95, 5)).toBe('amber');
  });

  it('returns amber at the lower edge of the warn band (inclusive)', () => {
    expect(slaColor(90, 95, 5)).toBe('amber');
  });

  it('returns red below the warn band', () => {
    expect(slaColor(89, 95, 5)).toBe('red');
  });

  it('clamps negative warn percent to zero (red just below target)', () => {
    expect(slaColor(94, 95, -5)).toBe('red');
  });

  it('clamps oversized warn percent so amber covers down to 0', () => {
    expect(slaColor(50, 95, 999)).toBe('amber');
    expect(slaColor(0, 95, 999)).toBe('amber');
  });

  it('returns green at 100% with zero warn band', () => {
    expect(slaColor(100, 100, 0)).toBe('green');
  });

  it('returns red just under target when warn band is zero', () => {
    expect(slaColor(99, 100, 0)).toBe('red');
  });

  it('returns neutral when both target and actual are null', () => {
    expect(slaColor(null, null, 5)).toBe('neutral');
  });

  it('handles NaN actual as neutral', () => {
    expect(slaColor(Number.NaN, 95, 5)).toBe('neutral');
  });
});
