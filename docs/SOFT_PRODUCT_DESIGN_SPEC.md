# Soft Product Design Spec

Canonical reference for Guichet's UI. Replaces the previous brutalist spec. All new features MUST conform — no exceptions without updating this doc first.

## Direction

Calm, polished, dense. Three-panel workspace (queue / chat / context). Focus on scannability, SLA awareness, minimal friction. Inter-driven typography, subtle shadows, soft radii, purposeful motion.

## Design tokens

All colors, radii, shadows, and spacing are CSS custom properties in [`client/src/index.css`](../client/src/index.css). **Never hardcode hex or px values in components** — use tokens. New tokens get added to `index.css` and documented here.

### Palette — Light

| Token | Value |
|---|---|
| `--color-bg-base` | `#f5f6fa` |
| `--color-bg-surface` | `#ffffff` |
| `--color-bg-elevated` | `#f7f8fb` |
| `--color-bg-hover` | `#eef0f6` |
| `--color-border` | `#e6e8ef` |
| `--color-border-strong` | `#d4d7e0` |
| `--color-ink` | `#14162b` |
| `--color-ink-soft` | `#4d5069` |
| `--color-ink-muted` | `#878ba1` |
| `--color-whisper-bg` | `#fff4e6` |
| `--color-whisper-ink` | `#a15c1f` |
| `--color-urgent` | `#d64545` |
| `--color-urgent-soft` | `#fde9e9` |
| `--color-ok` | `#2f9e5f` |
| `--color-ok-soft` | `#e4f5ea` |
| `--color-scrim` | `rgba(16, 20, 45, 0.35)` |

### Palette — Dark

| Token | Value |
|---|---|
| `--color-bg-base` | `#0e1020` |
| `--color-bg-surface` | `#171a30` |
| `--color-bg-elevated` | `#1e2139` |
| `--color-bg-hover` | `#262a44` |
| `--color-border` | `#252840` |
| `--color-border-strong` | `#373c5a` |
| `--color-ink` | `#eceef5` |
| `--color-ink-soft` | `#a8acc3` |
| `--color-ink-muted` | `#6f7391` |
| `--color-whisper-bg` | `#3a2a1a` |
| `--color-whisper-ink` | `#e8b88a` |
| `--color-urgent` | `#ff7a7a` |
| `--color-urgent-soft` | `#3a1e1e` |
| `--color-ok` | `#5fd08a` |
| `--color-ok-soft` | `#1a2e23` |
| `--color-scrim` | `rgba(0, 0, 0, 0.55)` |

### Accent — Indigo (default)

| Mode | `--color-accent` | `--color-accent-soft` |
|---|---|---|
| Light | `#5b5bd6` | `#eef0ff` |
| Dark | `#8b8cff` | `#2a2b52` |

**Future work (not this redesign):** accent is fixed to indigo for v1. Future enhancement will expose per-user or per-partner accent picker (teal / violet / amber / etc.). When that lands, the same `--color-accent` / `--color-accent-soft` tokens get swapped per-theme — components keep referencing the tokens; nothing else changes.

### Shadows — Light

| Token | Value |
|---|---|
| `--shadow` | `0 1px 2px rgba(16,20,45,0.04), 0 1px 1px rgba(16,20,45,0.03)` |
| `--shadow-card` | `0 1px 3px rgba(16,20,45,0.06), 0 8px 24px rgba(16,20,45,0.04)` |
| `--shadow-modal` | `0 20px 48px rgba(16,20,45,0.24), 0 4px 12px rgba(16,20,45,0.1)` |

### Shadows — Dark

| Token | Value |
|---|---|
| `--shadow` | `0 1px 2px rgba(0,0,0,0.3)` |
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.25)` |
| `--shadow-modal` | `0 20px 48px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)` |

### Radii

| Use | Value |
|---|---|
| Card / panel / modal | `14px` |
| Button / small surface | `8px` |
| Chip / pill / tag | `999px` |
| Avatar (round — default) | `999px` |
| Avatar (squircle — opt-in) | `8px` |
| Message bubble — tailed (default) | `12px`, corner near avatar `4px` |
| Message bubble — pill | `18px` |
| Message bubble — squared | `4px` |

### Spacing

Use the numbers, not a scale alias. Keep rhythm consistent.

| Use | px |
|---|---|
| Card padding | 16–24 |
| Section padding | 20 |
| Row padding | 12 |
| Gaps (choose one) | 4 / 6 / 8 / 10 / 12 / 14 / 16 |

## Typography

| Surface | Font | Size | Weight |
|---|---|---|---|
| Wordmark ("Guichet") | Inter | 16 | 700, letter-spacing `-0.3` |
| Panel title | Inter | 17 | 600, letter-spacing `-0.2` |
| Section title | Inter | 16 | 600 |
| Uppercase section label | Inter | 11 | 600, letter-spacing `0.4`, `text-transform: uppercase` |
| Message body | Inter | 15 | 400 |
| Row name / strong body | Inter | 14 | 600 |
| Body | Inter | 13 | 400 |
| Metadata | Inter | 12 | 400 |
| Micro label / chip | Inter | 11 | 600 |
| Ticket ID (`#4421`) | JetBrains Mono | 11 | 600 |
| Timestamp in message header | Inter | 12 | 400 (prose-friendly) |
| Inline code + code blocks | JetBrains Mono | 12 | 400 |

**Font rule:** Inter is the default everywhere. JetBrains Mono is scoped to **code blocks, inline code, and ticket IDs**. Do NOT use mono for button chrome, labels, placeholders, badges, or timestamps in chat headers — that's brutalist-era behavior and is gone.

### Accessibility fonts

- **Dyslexic mode** (`.dyslexic-mode`) — swaps body font to Lexend, raises line-height to 1.7. Applied via CSS variable override; no component changes needed.

## Motion

Purposeful only. Never decorative. Theme transitions are the only background/color animation allowed.

| Keyframe | Effect | Duration | Used on |
|---|---|---|---|
| `v2p-slide-in` | opacity 0→1, translateY 8→0 | 260ms ease-out | new messages, toasts |
| `v2p-fade` | opacity 0→1 | 150ms ease-out | modal scrim |
| `v2p-pop` | opacity 0→1, scale 0.96→1 | 180ms ease-out | modal cards |
| `v2p-pulse` | opacity 1↔0.55 | 1.8s ease-in-out infinite | unread badges |
| `v2p-dot` | translateY 0↔-4, opacity 0.4↔1 | 1s, stagger 0.15s | typing dots |
| (theme transition) | on `bg`, `color` | 200–220ms ease | theme switch |

**`prefers-reduced-motion: reduce`** kills all animations and transitions globally. Always respect it — do not override per-component.

## Component contracts

Short rule set — the long-form shape/size details are in the prototype (`design_handoff_chat_redesign/`).

### Button

- Primary: `bg: var(--color-accent)`, `color: #fff`, no border, radius 8, padding `7px 14px`, font-size 13, weight 500.
- Secondary: `bg: var(--color-bg-surface)`, `color: var(--color-ink)`, `border: 1px solid var(--color-border-strong)`, `box-shadow: var(--shadow)`, same radius/padding/size.
- Disabled: `opacity: 0.4`, `cursor: not-allowed`.

### Card / panel

- `bg: var(--color-bg-surface)`, `border-radius: 14px`, `box-shadow: var(--shadow-card)`.
- Full-height in the three-panel layout; `overflow: hidden` unless scrollable content.

### Chip / pill

- `border-radius: 999px`, padding `2–3px 8–10px`, font-size 11–12, weight 500–600.
- Use `--color-accent-soft` bg + `--color-accent` text for informational; `--color-urgent-soft` / `--color-urgent` for alerts.

### Message bubble

- Self: `bg: var(--color-accent-soft)`, border `1px solid var(--color-accent)22` (hex alpha).
- Other: `bg: var(--color-bg-elevated)`, border `1px solid var(--color-border)`.
- Padding `10px 14px`, font-size 15, line-height 1.55.
- Default shape: **tailed** (12px radius, corner near avatar cut to 4px).
- Whisper: full-width centered max-width 640, `bg: var(--color-whisper-bg)`, dashed `1px solid var(--color-whisper-ink)`, radius 10. Lock emoji header.

### Avatar

- Round (default): `border-radius: 999px`, solid background color + 2-letter initials in white.
- Size: 44 (context header), 40 (chat header), 32 (row + message), 30 (navbar), 26 (assignment row).

### Modal

- Scrim: fixed inset-0, `bg: var(--color-scrim)`, `v2p-fade` 150ms.
- Card: 440 wide, radius 14, `box-shadow: var(--shadow-modal)`, `v2p-pop` 180ms.
- Footer: `bg: var(--color-bg-elevated)`, right-aligned action row, top border.

### Toast

- Fixed bottom-right, stack 8px gap.
- Surface card (bg, border, radius 10, `shadow-card`), padding `10px 14px`, min-width 240.
- Colored status dot + title + optional body + dismiss.
- Auto-dismiss 3500ms. Enter via `v2p-slide-in`.

## Accessibility modes

| Mode | Class | Behavior |
|---|---|---|
| Dark | `.dark` on `<html>` | Palette swap via CSS vars |
| Dyslexic | `.dyslexic-mode` on `<html>` | Lexend font + relaxed line-height |
| Monochrome | `.monochrome-mode` on `<html>` | Accent collapses to ink; hierarchy via border + shadow + weight |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` | Disables all animations/transitions |

Future (out of scope for redesign): high-contrast mode (AAA), text-scale multiplier (100 / 115 / 130%).

## Mandates for new features

1. **Token-only styling.** No hex literals, no hardcoded shadows, no hardcoded radii in `*.tsx`. Use `var(--...)` or Tailwind utilities that map to tokens.
2. **Compose from shared primitives.** Use `<Button>`, `<Card>`, `<Pill>`, `<Modal>`, `<Avatar>`, `<Toast>` — don't hand-roll.
3. **Font rule.** Inter for prose, JetBrains Mono only for code / IDs / inline code.
4. **Motion whitelist.** Use documented keyframes only. Respect `prefers-reduced-motion`.
5. **Theme parity.** Every new component must work in both `.dark` and default theme. Test both. Monochrome + dyslexic should inherit automatically if tokens are used.
6. **Density first.** Preserve dense information. Don't inflate padding / font-sizes / line-heights beyond the spec.
7. **If you need a new token,** add it to `index.css` AND to this doc. If you find yourself reaching for a hex, stop — add a token.

## References

- Prototype source: `D:/Projects_Coding/design_handoff_chat_redesign/`
- Tokens: [`client/src/index.css`](../client/src/index.css)
- Primitives: `client/src/components/ui/` (introduced in phase 2 of the redesign)
