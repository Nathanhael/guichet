# Theme System Improvements — Design Spec

**Date:** 2026-03-15
**Status:** Implemented

---

## 1. Problem Statement

The Solaris theme system works but has five loose ends:

- Tailwind's `brand` palette is hardcoded to iKanbi Navy. Partner `primaryColor`/`secondaryColor` only override two CSS variables, so shade variants (`brand-100`, `brand-700`, etc.) ignore partner branding.
- Dark, dyslexic, and high-contrast modes are independent toggles with `!important` conflicts when stacked.
- Glass defaults are duplicated in `index.css` `:root` and `useTheme.ts`.
- Admins configure branding blind — no preview before saving.
- The business hours guard has no E2E coverage.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Palette generation | JS in `useTheme.ts` injecting CSS vars | Fits existing pattern, no browser compat issues |
| Mode conflicts | Priority cascade (dark → dyslexic → high-contrast) | Preserves user choice, more inclusive |
| Theme preview | Inline card below admin branding form | Lightweight, immediate feedback |

---

## 3. Dynamic Palette Generation

### 3.1 Algorithm

Add `generatePalette(hex: string): Record<string, string>` to a new `client/src/utils/colorUtils.ts`.

Steps:
1. Parse hex to HSL.
2. Generate 10 shades (50, 100, 200, ..., 900) by varying lightness:
   - Shade 50: clamp lightness to ~95%
   - Shade 500: original color lightness
   - Shade 900: clamp lightness to ~15%
   - Intermediate shades: piecewise linear interpolation — two segments: 50→500 (light to original) and 500→900 (original to dark)
3. Preserve hue and adjust saturation slightly (reduce at extremes to avoid neon artifacts).
4. Return `{ '50': '#...', '100': '#...', ... '900': '#...' }`.

### 3.2 Integration in `useTheme.ts`

```
const palette = generatePalette(manifest.primaryColor);
Object.entries(palette).forEach(([shade, color]) => {
  root.style.setProperty(`--brand-${shade}`, color);
});
// Same for secondaryColor → --brand-secondary-{shade}
```

### 3.3 Tailwind Config Update

Replace hardcoded `brand` colors in `tailwind.config.ts`:

```ts
brand: {
  50:  'var(--brand-50)',
  100: 'var(--brand-100)',
  // ... through 900
  DEFAULT: 'var(--brand-primary)',
}
```

### 3.4 Fallback

Extract existing inline fallbacks into named constants:
```ts
const DEFAULT_PRIMARY = '#a855f7';
const DEFAULT_SECONDARY = '#3b82f6';
```

Restructure `useTheme.ts` to remove the early `if (!manifest) return;` guard. Instead, always run the effect — use defaults when no manifest is loaded. This ensures palette CSS variables are always set (critical since Tailwind will reference them).

### 3.5 Unit Tests

Add `client/src/utils/__tests__/colorUtils.test.ts` covering:
- `hexToHsl()` / `hslToHex()` round-trip accuracy
- `generatePalette()` produces 10 shades with correct lightness ordering
- Edge cases: very dark/light input colors, pure grays (saturation 0)

### 3.6 Contrast Safety

When generating palettes, components using `dark:bg-brand-800` expect near-black backgrounds. If a partner's primary color is bright (e.g., yellow), shade 800 will still be dark due to the lightness clamping (shade 800 → ~20% lightness). However, add a `getContrastRatio(fg, bg)` utility to `colorUtils.ts` for future use, and document the assumption that shade 50–200 are always light, 700–900 are always dark.

---

## 4. Mode Conflict Resolution

### 4.1 Priority Cascade

Layers applied in order (later overrides earlier):

1. **Base** — Light theme (`:root`)
2. **Dark** — `.dark` selector
3. **Dyslexic** — `.dyslexic-mode` (font family, line-height, spacing, background warmth)
4. **High Contrast** — `.high-contrast-mode` (color overrides, border strengthening)

### 4.2 CSS Refactoring Rules

- Remove `!important` from accessibility mode styles (`.dyslexic-mode`, `.high-contrast-mode`) in `index.css`, **except** keep `!important` on the dyslexic `font-family: 'Lexend'` rule (the `*` selector needs it to override Tailwind utilities and third-party component fonts). Leave `!important` on unrelated utility classes (`.zen-glass`, `.whatsapp-bg`, print styles) untouched.
- Use compound selectors for specificity ordering. Example:
  ```css
  /* Base dark glass */
  .dark .glass-card { ... }
  /* High contrast overrides dark */
  .high-contrast-mode.dark .glass-card { ... }
  /* Triple-compound selectors only needed if future overlap arises */
  ```
- Dyslexic mode concerns: font-family, line-height, letter-spacing, background warmth.
- High contrast concerns: foreground/background colors, border colors, gradient removal.
- No overlap between dyslexic and high-contrast concerns = minimal conflict.

### 4.3 Combinations to Test

All 8 permutations:

| # | Dark | Dyslexic | High Contrast | Key check |
|---|------|----------|---------------|-----------|
| 1 | off  | off      | off           | Default light theme |
| 2 | on   | off      | off           | Dark backgrounds, adjusted glass |
| 3 | off  | on       | off           | Lexend font, warm background, spacing |
| 4 | on   | on       | off           | Lexend + dark bg |
| 5 | off  | off      | on            | Pure B&W, no gradients |
| 6 | on   | off      | on            | Pure black bg, white text |
| 7 | off  | on       | on            | Lexend + B&W palette + warm touches |
| 8 | on   | on       | on            | Lexend + pure black bg + white text |

### 4.4 Testing Approach

Add a Playwright visual regression test that:
1. Logs in as support (has the richest UI).
2. Iterates through all 8 toggle combinations.
3. Takes a screenshot of the chat view for each.
4. Asserts no console errors.

Manual review of screenshots on first run to establish baselines.

---

## 5. Glass Defaults — Single Source of Truth

### 5.1 Current Problem

`index.css` `:root` sets:
```css
--glass-opacity: 0.3;
--glass-blur: 16px;
/* etc. */
```

`useTheme.ts` also sets these same values when no `themeConfig` is present. Both run, creating a race condition (hook runs after CSS, so hook "wins" — but the intent is unclear).

### 5.2 Solution

1. Remove only `--glass-*` variable declarations from `index.css` `:root` and `.dark` selectors. Keep `--brand-primary`, `--brand-secondary`, `--accent-color`, and `--border-radius` in `:root` as initial fallbacks (needed before `useTheme` runs on first render).
2. Add a `GLASS_DEFAULTS` constant in `useTheme.ts`:
   ```ts
   const GLASS_DEFAULTS = {
     light: { opacity: '0.3', blur: '16px', saturate: '150%', border: 'rgba(255,255,255,0.4)' },
     dark:  { opacity: '0.1', blur: '20px', saturate: '180%', border: 'rgba(255,255,255,0.1)' },
   };
   ```
3. `useTheme` selects light/dark defaults based on `darkMode` state, then overlays partner `themeConfig`.
4. The hook already re-runs when `darkMode` changes (it's a Zustand dependency), so this is reactive.

---

## 6. Admin Theme Preview Card

### 6.1 Component: `ThemePreviewCard.tsx`

Located in `client/src/components/admin/ThemePreviewCard.tsx`.

**Props:**
```ts
interface ThemePreviewProps {
  primaryColor: string;
  secondaryColor: string;
  glassBlur?: string;
  glassOpacity?: string;
  borderRadius?: string;
}
```

**Renders:**
- A wrapper `<div>` with a gradient background using the selected primary/secondary colors.
- A mini glass card (using inline styles scoped via CSS variables on the wrapper, not the global `:root`).
- Inside the glass card: a sample chat bubble (left-aligned "other"), a sample chat bubble (right-aligned "mine"), and a sample button.
- All using the passed-in colors, so it updates live as the admin types.

### 6.2 Integration

Branding is configured in `client/src/views/PlatformView.tsx` (the partner editor modal, Platform Operator only). The color pickers for `primaryColor` and `secondaryColor` are at ~line 182–195.

Render `<ThemePreviewCard />` below the color picker inputs inside the `editingPartner` modal. Pass the local `editingPartner` state (not saved values) so it previews unsaved changes.

### 6.3 Scoping

The preview must NOT affect the rest of the page. Achieve this by:
- Setting CSS variables on the preview wrapper div only (not `document.documentElement`).
- Using inline styles or a `style` attribute for the CSS variable overrides.
- Child elements reference `var(--brand-primary)` which resolves to the wrapper's scope.

---

## 7. E2E Business Hours Guard

### 7.1 Test File: `e2e/tests/business-hours.spec.ts`

**Constraint:** Playwright's clock API only mocks browser-side `Date` — it cannot affect the server's `new Date()` in `businessHours.ts`. Two feasible approaches:

**Approach A (recommended): Run against mock server with controllable time.**
The mock server (`e2e/mock`) can be configured to return `businessHoursOpen: false` in the socket `businessHours:status` event. This tests the client-side guard without needing to manipulate server time.

**Approach B: Use partner-specific hours set to a known window.**
Use the tRPC `updateBusinessHours` mutation (as admin) to set the test partner's hours to a narrow window (e.g., 00:00–00:01), then log in as agent and verify the guard appears. This works against Docker but is timing-sensitive.

**Chosen: Approach A** — more reliable and faster.

**Scenario:**
1. Start mock server configured to emit `businessHours:status` with `open: false`.
2. Log in as agent.
3. Assert the business hours guard notice is visible.
4. Assert ticket creation is blocked.
5. Emit `businessHours:status` with `open: true` via mock server.
6. Assert the guard disappears and ticket creation is available.

**Note:** This test runs against the `mock` Playwright project.

---

## 8. Files Changed

| File | Change |
|------|--------|
| `client/src/utils/colorUtils.ts` | **New** — `generatePalette()`, `hexToHsl()`, `hslToHex()`, `getContrastRatio()` |
| `client/src/utils/__tests__/colorUtils.test.ts` | **New** — Unit tests for palette generation |
| `client/src/hooks/useTheme.ts` | Palette injection, `GLASS_DEFAULTS`, remove early-return guard, extract constants |
| `client/tailwind.config.ts` | Replace hardcoded `brand` palette with CSS variable references |
| `client/src/index.css` | Remove `--glass-*` vars from `:root`/`.dark`, refactor mode cascade, remove mode `!important` |
| `client/src/components/admin/ThemePreviewCard.tsx` | **New** — inline preview card |
| `client/src/views/PlatformView.tsx` | Add `<ThemePreviewCard />` in partner editor modal |
| `e2e/mock-server/index.ts` | Add `businessHours:status` socket event support |
| `e2e/tests/business-hours.spec.ts` | **New** — E2E guard test (mock project) |
| `e2e/tests/theme-modes.spec.ts` | **New** — Visual regression for 8 mode combinations |

## 9. Out of Scope

- Palette generation for `accentColor` (keep static for now).
- Admin UI for editing `ThemeConfig` fields beyond primary/secondary colors (future work).
- Server-side theme validation.
