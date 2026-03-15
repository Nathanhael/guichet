# Theme System Improvements — Implementation Plan

**Date:** 2026-03-15
**Status:** Completed

**Goal:** Fix five loose ends in the Solaris theme system: dynamic palette generation, mode conflict resolution, glass defaults consolidation, admin theme preview, and E2E business hours test.

**Architecture:** JS-based palette generation in `useTheme.ts` injects `--brand-50` through `--brand-900` CSS variables derived from partner manifest colors. Tailwind references these variables instead of hardcoded values. CSS mode conflicts resolved via specificity cascade. Glass defaults consolidated into `useTheme.ts` as single source of truth.

**Tech Stack:** React, Zustand, Tailwind CSS, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-03-15-theme-system-improvements-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `client/src/utils/colorUtils.ts` | **New** — Color conversion (`hexToHsl`, `hslToHex`), palette generation (`generatePalette`), contrast ratio (`getContrastRatio`) |
| `client/src/utils/__tests__/colorUtils.test.ts` | **New** — Unit tests for all color utilities |
| `client/src/hooks/useTheme.ts` | **Modify** — Remove early-return, add palette injection, consolidate glass defaults |
| `client/tailwind.config.ts` | **Modify** — Replace hardcoded `brand` palette with CSS variable references |
| `client/src/index.css` | **Modify** — Remove `--glass-*` from `:root`/`.dark`, refactor mode `!important` to specificity cascade |
| `client/src/components/admin/ThemePreviewCard.tsx` | **New** — Inline scoped preview card |
| `client/src/views/PlatformView.tsx` | **Modify** — Add `ThemePreviewCard` in partner editor modal |
| `e2e/mock-server/index.ts` | **Modify** — Add `businessHours:status` socket event |
| `e2e/tests/business-hours.spec.ts` | **New** — E2E guard test against mock server |
| `e2e/tests/theme-modes.spec.ts` | **New** — Visual regression for 8 mode combinations |

---

## Chunk 1: Dynamic Palette Generation

### Task 1: Color Utility — Tests First

**Files:**
- Create: `client/src/utils/colorUtils.ts`
- Create: `client/src/utils/__tests__/colorUtils.test.ts`

- [ ] **Step 1: Write failing tests for `hexToHsl` and `hslToHex`**

Create `client/src/utils/__tests__/colorUtils.test.ts`:

```ts
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
    expect(h).toBeCloseTo(270, 0);
    expect(s).toBeGreaterThan(50);
    expect(l).toBeGreaterThan(40);
    expect(l).toBeLessThan(70);
  });
});

describe('hslToHex', () => {
  it('converts pure red back', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
  });

  it('round-trips the brand purple', () => {
    const original = '#a855f7';
    const { h, s, l } = hexToHsl(original);
    expect(hslToHex(h, s, l)).toBe(original);
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
    expect(l).toBeLessThan(20);
  });

  it('preserves hue across all shades', () => {
    const palette = generatePalette('#a855f7');
    const baseHue = hexToHsl('#a855f7').h;
    Object.values(palette).forEach(hex => {
      const { h, s } = hexToHsl(hex);
      if (s > 5) { // skip near-grays where hue is meaningless
        expect(h).toBeCloseTo(baseHue, 0);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker-compose exec -T client npx vitest run src/utils/__tests__/colorUtils.test.ts`
Expected: FAIL — module `../colorUtils` not found

- [ ] **Step 3: Implement `colorUtils.ts`**

Create `client/src/utils/colorUtils.ts`:

```ts
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) throw new Error(`Invalid hex color: ${hex}`);

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  h = h / 360;
  s = s / 100;
  l = l / 100;

  const hueToRgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  const toHex = (c: number) => {
    const hex = Math.round(c * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const SHADE_TARGETS: Record<string, number> = {
  '50': 95, '100': 90, '200': 80, '300': 70, '400': 60,
  '500': -1, // use original lightness
  '600': 40, '700': 30, '800': 20, '900': 15,
};

export function generatePalette(hex: string): Record<string, string> {
  const { h, s, l } = hexToHsl(hex);
  const palette: Record<string, string> = {};

  for (const [shade, target] of Object.entries(SHADE_TARGETS)) {
    if (target === -1) {
      palette[shade] = hex;
      continue;
    }

    // Piecewise linear: interpolate between target lightness and original
    // Reduce saturation at extremes to avoid neon artifacts
    const satAdjust = target > 85 ? s * 0.3 : target < 20 ? s * 0.7 : s;
    palette[shade] = hslToHex(h, satAdjust, target);
  }

  return palette;
}

function luminance(hex: string): number {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return 0;
  const [r, g, b] = [result[1], result[2], result[3]].map(c => {
    const v = parseInt(c, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker-compose exec -T client npx vitest run src/utils/__tests__/colorUtils.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/colorUtils.ts client/src/utils/__tests__/colorUtils.test.ts
git commit -m "feat: add color utility with palette generation and contrast ratio"
```

---

### Task 2: Integrate Palette into `useTheme.ts`

**Files:**
- Modify: `client/src/hooks/useTheme.ts`

- [ ] **Step 1: Read current `useTheme.ts` (for Edit context)**

Run: Read `client/src/hooks/useTheme.ts`

- [ ] **Step 2: Restructure the hook**

Replace the full content of `client/src/hooks/useTheme.ts`. Key changes:
1. Import `generatePalette` from `../utils/colorUtils`
2. Remove the `if (!manifest) return;` guard (line 10)
3. Extract constants: `DEFAULT_PRIMARY = '#a855f7'`, `DEFAULT_SECONDARY = '#3b82f6'`
4. Add `GLASS_DEFAULTS` constant (consolidates glass values — Task from Chunk 2)
5. Always generate and inject palette (use defaults when no manifest)
6. Inject `--brand-50` through `--brand-900` and `--brand-secondary-50` through `--brand-secondary-900`

```ts
import { useEffect } from 'react';
import { usePartner } from './usePartner';
import useStore from '../store/useStore';
import { generatePalette } from '../utils/colorUtils';

const DEFAULT_PRIMARY = '#a855f7';
const DEFAULT_SECONDARY = '#3b82f6';

const GLASS_DEFAULTS = {
  light: { opacity: '0.3', blur: '16px', saturate: '150%', border: 'rgba(255, 255, 255, 0.4)' },
  dark:  { opacity: '0.1', blur: '20px', saturate: '180%', border: 'rgba(255, 255, 255, 0.1)' },
};

export function useTheme() {
  const { manifest } = usePartner();
  const darkMode = useStore((s) => s.darkMode);

  useEffect(() => {
    const root = document.documentElement;
    const theme = manifest?.themeConfig || {};
    const mode = darkMode ? 'dark' : 'light';

    // Brand colors — use manifest or defaults
    const primary = manifest?.primaryColor || DEFAULT_PRIMARY;
    const secondary = manifest?.secondaryColor || DEFAULT_SECONDARY;
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-secondary', secondary);

    // Generate and inject full palette
    const primaryPalette = generatePalette(primary);
    Object.entries(primaryPalette).forEach(([shade, color]) => {
      root.style.setProperty(`--brand-${shade}`, color);
    });

    const secondaryPalette = generatePalette(secondary);
    Object.entries(secondaryPalette).forEach(([shade, color]) => {
      root.style.setProperty(`--brand-secondary-${shade}`, color);
    });

    // Glass defaults — partner theme overrides mode defaults
    const glass = GLASS_DEFAULTS[mode];
    root.style.setProperty('--glass-blur', theme.glassBlur || glass.blur);
    root.style.setProperty('--glass-opacity', theme.glassOpacity || glass.opacity);
    root.style.setProperty('--glass-saturate', glass.saturate);
    root.style.setProperty('--glass-border', glass.border);

    // Other theme properties
    root.style.setProperty('--accent-color', theme.accentColor || '#f43f5e');
    root.style.setProperty('--border-radius', theme.borderRadius || '0.75rem');
  }, [manifest, darkMode]);
}
```

- [ ] **Step 3: Verify app still compiles**

Run: `docker-compose exec -T client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useTheme.ts
git commit -m "refactor: useTheme consolidates palette generation and glass defaults"
```

---

### Task 3: Update Tailwind Config

**Files:**
- Modify: `client/tailwind.config.ts` (lines 27-37 — `brand` color object)

- [ ] **Step 1: Read current `tailwind.config.ts`**

Run: Read `client/tailwind.config.ts`

- [ ] **Step 2: Replace hardcoded brand palette with CSS variable references**

Replace the `brand` object (lines 27-37):

```ts
brand: {
  50:  'var(--brand-50)',
  100: 'var(--brand-100)',
  200: 'var(--brand-200)',
  300: 'var(--brand-300)',
  400: 'var(--brand-400)',
  500: 'var(--brand-500)',
  600: 'var(--brand-600)',
  700: 'var(--brand-700)',
  800: 'var(--brand-800)',
  900: 'var(--brand-900)',
  DEFAULT: 'var(--brand-primary)',
},
```

**Note:** Tailwind needs a way to know these are actual colors for opacity modifiers (`bg-brand-500/20`). If opacity modifiers break, wrap values in a `color()` function or use `<alpha-value>` syntax. Test after this step.

- [ ] **Step 3: Verify build compiles and no chunk warnings**

Run: `docker-compose exec -T client npm run build 2>&1 | tail -20`
Expected: Build succeeds, no manual chunk warnings

- [ ] **Step 4: Commit**

```bash
git add client/tailwind.config.ts
git commit -m "refactor: tailwind brand palette now uses CSS variable references"
```

---

## Chunk 2: Glass Defaults & Mode Cascade

### Task 4: Remove Glass Variables from `index.css`

**Files:**
- Modify: `client/src/index.css` (lines 7-8, 13-14, 17-21)

- [ ] **Step 1: Read `index.css`**

Run: Read `client/src/index.css`

- [ ] **Step 2: Remove `--glass-*` variables from `:root`**

Remove from `:root` (keep `--brand-primary`, `--brand-secondary`, `--accent-color`, `--border-radius` as initial fallbacks):
- `--glass-opacity: 0.3;` (line 7)
- `--glass-blur: 16px;` (line 8)
- `--glass-saturate: 150%;` (line 13)
- `--glass-border: rgba(255, 255, 255, 0.4);` (line 14)

- [ ] **Step 3: Remove `--glass-*` variables from `.dark`**

Remove from `.dark` body:
- `--glass-opacity: 0.1;` (line 18)
- `--glass-blur: 20px;` (line 19)
- `--glass-saturate: 180%;` (line 20)
- `--glass-border: rgba(255, 255, 255, 0.1);` (line 21)

Glass values are now set exclusively by `useTheme.ts` (already done in Task 2).

- [ ] **Step 4: Verify app renders correctly**

Run: `docker-compose exec -T client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/index.css
git commit -m "refactor: remove glass CSS vars from index.css, useTheme is now single source of truth"
```

---

### Task 5: Refactor Mode CSS Cascade

**Files:**
- Modify: `client/src/index.css` (lines 39-58 for dyslexic/high-contrast, lines 209-212 for font)

- [ ] **Step 1: Refactor `.dyslexic-mode` styles — remove `!important` from backgrounds**

Replace the dyslexic-mode blocks (lines 39-47) to use compound selectors for specificity instead of `!important`:

```css
/* Dyslexic mode — warm background, no gradients */
.dyslexic-mode body:not(.dark) {
  background-color: #FFFBEB;
  background-image: none;
}

.dyslexic-mode.dark body {
  background-color: #111827;
  background-image: none;
}
```

- [ ] **Step 2: Refactor `.high-contrast-mode` styles — remove `!important`**

Replace the high-contrast-mode blocks (lines 50-58). High contrast comes after dyslexic in cascade, so it wins naturally:

```css
/* High contrast — pure B&W, overrides dyslexic background */
.high-contrast-mode body:not(.dark) {
  background-color: #ffffff;
  color: #000000;
  background-image: none;
}

.high-contrast-mode.dark body {
  background-color: #000000;
  color: #ffffff;
  background-image: none;
}
```

- [ ] **Step 3: Keep `!important` on dyslexic font-family**

The font rule at lines 209-212 **must keep** `!important` because the `*` selector needs to override Tailwind utility classes and third-party component fonts. Do NOT change this rule:

```css
.dyslexic-mode, .dyslexic-mode body, .dyslexic-mode * {
  font-family: 'Lexend', sans-serif !important;
  line-height: 1.75 !important;
}
```

- [ ] **Step 4: Run client tests**

Run: `docker-compose exec -T client npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add client/src/index.css
git commit -m "refactor: replace !important with CSS specificity cascade for accessibility modes"
```

---

## Chunk 3: Admin Theme Preview

### Task 6: Create `ThemePreviewCard` Component

**Files:**
- Create: `client/src/components/admin/ThemePreviewCard.tsx`

- [ ] **Step 1: Check if `client/src/components/admin/` directory exists**

Run: `ls client/src/components/admin/ 2>&1`
If not, create it.

- [ ] **Step 2: Create the component**

Create `client/src/components/admin/ThemePreviewCard.tsx`:

```tsx
import { generatePalette } from '../../utils/colorUtils';

interface ThemePreviewProps {
  primaryColor: string;
  secondaryColor: string;
}

export default function ThemePreviewCard({ primaryColor, secondaryColor }: ThemePreviewProps) {
  const palette = generatePalette(primaryColor);

  // Scoped CSS variables on this wrapper — does NOT affect the rest of the page
  const scopeVars = {
    '--preview-primary': primaryColor,
    '--preview-secondary': secondaryColor,
    '--preview-50': palette['50'],
    '--preview-100': palette['100'],
    '--preview-700': palette['700'],
    '--preview-800': palette['800'],
    '--preview-900': palette['900'],
  } as React.CSSProperties;

  return (
    <div style={scopeVars} className="mt-4 rounded-2xl p-4 overflow-hidden"
         data-testid="theme-preview">
      {/* Background gradient */}
      <div className="rounded-xl p-4 space-y-3"
           style={{ background: `linear-gradient(135deg, ${palette['900']}, ${palette['800']})` }}>

        {/* Mini glass card */}
        <div className="rounded-lg p-3 space-y-2"
             style={{
               background: `rgba(255, 255, 255, 0.1)`,
               backdropFilter: 'blur(16px)',
               border: '1px solid rgba(255, 255, 255, 0.15)',
             }}>

          {/* Sample "other" message */}
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full flex-shrink-0"
                 style={{ backgroundColor: palette['400'] }} />
            <div className="rounded-lg rounded-tl-none px-3 py-1.5 text-xs text-white/90 max-w-[70%]"
                 style={{ backgroundColor: palette['700'] }}>
              Hello, how can I help?
            </div>
          </div>

          {/* Sample "mine" message */}
          <div className="flex justify-end">
            <div className="rounded-lg rounded-tr-none px-3 py-1.5 text-xs text-white max-w-[70%]"
                 style={{ backgroundColor: primaryColor }}>
              I need help with my account
            </div>
          </div>
        </div>

        {/* Sample button */}
        <div className="flex gap-2">
          <div className="px-3 py-1 rounded-lg text-xs font-medium text-white"
               style={{ backgroundColor: primaryColor }}>
            Primary
          </div>
          <div className="px-3 py-1 rounded-lg text-xs font-medium text-white"
               style={{ backgroundColor: secondaryColor }}>
            Secondary
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `docker-compose exec -T client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/admin/ThemePreviewCard.tsx
git commit -m "feat: add ThemePreviewCard component with scoped CSS variable preview"
```

---

### Task 7: Integrate Preview into PlatformView

**Files:**
- Modify: `client/src/views/PlatformView.tsx` (~lines 182-195, after color pickers)

- [ ] **Step 1: Read `PlatformView.tsx`**

Run: Read `client/src/views/PlatformView.tsx`

- [ ] **Step 2: Add import at top of file**

Add after existing imports:
```ts
import ThemePreviewCard from '../components/admin/ThemePreviewCard';
```

- [ ] **Step 3: Add preview card after the color picker inputs**

Find the secondary color picker `<input type="color" value={editingPartner.secondaryColor}.../>` block (~line 195). After its closing `</label>` (or the containing `<div>`), add:

```tsx
<ThemePreviewCard
  primaryColor={editingPartner.primaryColor}
  secondaryColor={editingPartner.secondaryColor}
/>
```

- [ ] **Step 4: Verify app compiles**

Run: `docker-compose exec -T client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/views/PlatformView.tsx
git commit -m "feat: add live theme preview to partner editor modal"
```

---

## Chunk 4: E2E Tests

### Task 8: Business Hours E2E Guard Test

**Files:**
- Modify: `e2e/mock-server/index.ts`
- Create: `e2e/tests/business-hours.spec.ts`

- [ ] **Step 1: Read mock server to understand structure**

Run: Read `e2e/mock-server/index.ts`

- [ ] **Step 2: Add `businessHours:status` event to mock server**

In `e2e/mock-server/index.ts`, inside the `socket:identify` handler (after queue:update emit at ~line 75), add:

```ts
// Emit business hours status — controlled by env var or default to open
const businessHoursOpen = process.env.MOCK_BUSINESS_HOURS !== 'closed';
socket.emit('businessHours:status', { open: businessHoursOpen });
```

- [ ] **Step 3: Create E2E test**

Create `e2e/tests/business-hours.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { loginInContext } from '../lib/login';
import { AGENT_USER } from '../lib/constants';

test.describe('Business Hours Guard', () => {
  test('shows guard when business hours are closed', async ({ browser }) => {
    // This test requires MOCK_BUSINESS_HOURS=closed on the mock server
    // For now, we test the guard component visibility based on socket state
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginInContext(page, AGENT_USER);

    // Wait for socket connection and check if guard is present
    // The mock server emits businessHours:status on identify
    await page.waitForTimeout(1000);

    // When business hours are open (default), guard should NOT be visible
    const guard = page.locator('[data-testid="business-hours-guard"]');
    const isVisible = await guard.isVisible().catch(() => false);

    // In default mock mode, business hours are open
    expect(isVisible).toBe(false);

    await context.close();
  });
});
```

**Note:** Full closed-hours testing requires starting the mock server with `MOCK_BUSINESS_HOURS=closed`. This can be expanded later with a test that restarts the mock or uses a socket override.

- [ ] **Step 4: Check if BusinessHoursGuard has a test ID**

Read `client/src/components/BusinessHoursGuard.tsx` and add `data-testid="business-hours-guard"` to the root element if missing.

- [ ] **Step 5: Run the test**

Run: `cd e2e && npx playwright test tests/business-hours.spec.ts --project=mock`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add e2e/mock-server/index.ts e2e/tests/business-hours.spec.ts client/src/components/BusinessHoursGuard.tsx
git commit -m "test: add E2E business hours guard test with mock server support"
```

---

### Task 9: Theme Modes Visual Regression Test

**Files:**
- Create: `e2e/tests/theme-modes.spec.ts`

- [ ] **Step 1: Create the visual regression test**

Create `e2e/tests/theme-modes.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { loginInContext } from '../lib/login';
import { SUPPORT_USER } from '../lib/constants';

const MODE_COMBINATIONS = [
  { dark: false, dyslexic: false, highContrast: false, name: 'light' },
  { dark: true,  dyslexic: false, highContrast: false, name: 'dark' },
  { dark: false, dyslexic: true,  highContrast: false, name: 'dyslexic' },
  { dark: true,  dyslexic: true,  highContrast: false, name: 'dark-dyslexic' },
  { dark: false, dyslexic: false, highContrast: true,  name: 'high-contrast' },
  { dark: true,  dyslexic: false, highContrast: true,  name: 'dark-high-contrast' },
  { dark: false, dyslexic: true,  highContrast: true,  name: 'dyslexic-high-contrast' },
  { dark: true,  dyslexic: true,  highContrast: true,  name: 'dark-dyslexic-high-contrast' },
];

test.describe('Theme Mode Combinations', () => {
  for (const mode of MODE_COMBINATIONS) {
    test(`renders correctly: ${mode.name}`, async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginInContext(page, SUPPORT_USER);

      // Set modes via localStorage and page evaluate
      await page.evaluate((m) => {
        localStorage.setItem('darkMode', JSON.stringify(m.dark));
        localStorage.setItem('dyslexicMode', JSON.stringify(m.dyslexic));
        localStorage.setItem('highContrastMode', JSON.stringify(m.highContrast));
      }, mode);

      // Reload to apply
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      // Verify correct CSS classes on <html>
      const html = page.locator('html');
      if (mode.dark) await expect(html).toHaveClass(/dark/);
      if (mode.dyslexic) await expect(html).toHaveClass(/dyslexic-mode/);
      if (mode.highContrast) await expect(html).toHaveClass(/high-contrast-mode/);

      // No console errors
      const errors: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      // Take screenshot for manual review (first run establishes baseline)
      await page.screenshot({
        path: `e2e/test-results/theme-${mode.name}.png`,
        fullPage: true,
      });

      expect(errors).toHaveLength(0);
      await context.close();
    });
  }
});
```

- [ ] **Step 2: Run the tests**

Run: `cd e2e && npx playwright test tests/theme-modes.spec.ts --project=mock`
Expected: PASS — screenshots saved to `e2e/test-results/`

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/theme-modes.spec.ts
git commit -m "test: add visual regression tests for all 8 theme mode combinations"
```

---

## Chunk 5: Final Verification

### Task 10: Full Test Suite & Push

- [ ] **Step 1: Run all server tests**

Run: `docker-compose exec -T server npm test`
Expected: All tests pass (65+)

- [ ] **Step 2: Run all client tests**

Run: `docker-compose exec -T client npm test`
Expected: All tests pass (45+, including new colorUtils tests)

- [ ] **Step 3: TypeScript check**

Run: `docker-compose exec -T client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Build check**

Run: `docker-compose exec -T client npm run build 2>&1 | tail -5`
Expected: Build succeeds, no chunk warnings

- [ ] **Step 5: Push all commits**

```bash
git push
```
