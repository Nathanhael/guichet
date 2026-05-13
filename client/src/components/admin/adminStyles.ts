// Shared Soft Product style constants for admin panels.
// Token references only — do not introduce hex literals.
// See docs/SOFT_PRODUCT_DESIGN_SPEC.md.

export const CARD =
  'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';

export const INPUT =
  'h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

export const INPUT_FULL = `w-full ${INPUT}`;

export const PRIMARY_BTN =
  'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-40 disabled:cursor-not-allowed transition-all';

export const SECONDARY_BTN =
  'h-9 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export const DANGER_BTN =
  'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-urgent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-40 disabled:cursor-not-allowed transition-all';

export const GHOST_BTN =
  'h-8 px-2.5 inline-flex items-center gap-1 rounded-[var(--radius-btn)] text-[12px] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors';

export const ICON_BTN =
  'w-8 h-8 inline-flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export const FIELD_LABEL =
  'block text-[11px] font-medium text-[var(--color-ink-muted)] mb-1.5';

export const COL_HEAD =
  'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';

export const SECTION_LABEL =
  'text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
