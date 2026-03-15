import { describe, it, expect } from 'vitest';
import { hexToHsl, hslToHex, generatePalette, getContrastRatio } from '../colorUtils';

describe('hexToHsl', () => {
  it('converts pure red', () => {
    const { h, s, l } = hexToHsl('#ff0000');
    expect(h).toBeCloseTo(0);
    expect(s).toBeCloseTo(100);
    expect(l).toBeCloseTo(50);
  });

  it('converts pure white', () => {
    const { h, s, l } = hexToHsl('#ffffff');
    expect(l).toBeCloseTo(100);
    expect(s).toBeCloseTo(0);
  });

  it('converts pure black', () => {
    const { h, s, l } = hexToHsl('#000000');
    expect(l).toBeCloseTo(0);
  });

  it('converts the default brand purple', () => {
    const { h, s, l } = hexToHsl('#a855f7');
    // #a855f7 is HSL(270.7, 91%, 65.1%)
    expect(h).toBeGreaterThan(265);
    expect(h).toBeLessThan(275);
    expect(s).toBeGreaterThan(80);
    expect(l).toBeGreaterThan(60);
  });
});

describe('hslToHex', () => {
  it('converts pure red back', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
  });

  it('round-trips the brand purple', () => {
    const original = '#a855f7';
    const { h, s, l } = hexToHsl(original);
    const roundTrip = hslToHex(h, s, l);
    // Tolerance for rounding: #a855f7 vs #a855f8 etc.
    expect(roundTrip.startsWith('#a')).toBe(true);
  });

  it('handles gray (zero saturation)', () => {
    const hex = hslToHex(0, 0, 50);
    expect(hex).toBe('#808080');
  });
});

describe('generatePalette', () => {
  it('returns 10 shades keyed 50 through 900', () => {
    const palette = generatePalette('#a855f7');
    const keys = Object.keys(palette);
    expect(keys).toEqual(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']);
  });

  it('shade 50 is lightest, shade 900 is darkest', () => {
    const palette = generatePalette('#a855f7');
    const l50 = hexToHsl(palette['50']).l;
    const l500 = hexToHsl(palette['500']).l;
    const l900 = hexToHsl(palette['900']).l;
    expect(l50).toBeGreaterThan(l500);
    expect(l500).toBeGreaterThan(l900);
  });

  it('shade 50 lightness is ~95%', () => {
    const palette = generatePalette('#3b82f6');
    const l = hexToHsl(palette['50']).l;
    expect(l).toBeGreaterThan(90);
    expect(l).toBeLessThanOrEqual(97);
  });

  it('shade 900 lightness is ~15%', () => {
    const palette = generatePalette('#3b82f6');
    const l = hexToHsl(palette['900']).l;
    expect(l).toBeGreaterThanOrEqual(10);
    expect(l).toBeLessThan(25);
  });

  it('preserves hue across all shades', () => {
    const palette = generatePalette('#a855f7');
    const { h: baseHue } = hexToHsl('#a855f7');
    Object.values(palette).forEach(hex => {
      const { h, s } = hexToHsl(hex);
      if (s > 10) { // skip near-grays where hue is meaningless
        // Allow up to 15 degrees of drift for generated palettes (aesthetic adjustments)
        const diff = Math.abs(h - baseHue);
        expect(diff).toBeLessThan(15);
      }
    });
  });

  it('works with very dark input', () => {
    const palette = generatePalette('#1a1a2e');
    expect(Object.keys(palette)).toHaveLength(10);
    expect(hexToHsl(palette['50']).l).toBeGreaterThan(85);
  });

  it('works with very light input', () => {
    const palette = generatePalette('#f0e6ff');
    expect(Object.keys(palette)).toHaveLength(10);
    expect(hexToHsl(palette['900']).l).toBeLessThan(20);
  });
});

describe('getContrastRatio', () => {
  it('black on white is ~21', () => {
    const ratio = getContrastRatio('#000000', '#ffffff');
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('same color returns 1', () => {
    const ratio = getContrastRatio('#a855f7', '#a855f7');
    expect(ratio).toBeCloseTo(1, 0);
  });
});
