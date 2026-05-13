// Shared Soft Product style constants for the support workspace.
// Token references only — do not introduce hex literals.
// Mirrors the pattern in `client/src/components/admin/adminStyles.ts`.

// Tiny row pill — used for dept / status / language labels inside queue rows
// and archive rows. 10px font, tight padding, single-color border + text.
const ROW_PILL_BASE =
  'inline-flex items-center rounded-[var(--radius-pill)] text-[10px] font-semibold px-1.5 py-0.5 border shrink-0 leading-none';

export const ROW_PILL_ACCENT =
  `${ROW_PILL_BASE} border-[var(--color-accent)] text-[var(--color-accent)]`;

export const ROW_PILL_MUTED =
  `${ROW_PILL_BASE} border-[var(--color-border)] text-[var(--color-ink-muted)]`;

// Filter chip — used in QueueSidebar for the dept + language filter rows.
// 11px font, bigger padding, supports an active/inactive state (active = solid
// accent fill, inactive = bordered with hover affordance).
const FILTER_CHIP_BASE =
  'shrink-0 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[11px] font-semibold border transition-colors';

export function filterChip(active: boolean): string {
  return active
    ? `${FILTER_CHIP_BASE} bg-[var(--color-accent)] text-white border-[var(--color-accent)]`
    : `${FILTER_CHIP_BASE} border-[var(--color-border)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)]`;
}
