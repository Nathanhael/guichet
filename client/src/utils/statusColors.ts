const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  online: { dot: 'bg-[var(--color-ok)]', text: 'text-[var(--color-ok)]' },
  away: { dot: 'bg-[var(--color-accent-amber)]', text: 'text-[var(--color-accent-amber)]' },
};

const OFFLINE_COLORS = { dot: 'bg-[var(--color-ink-muted)]', text: 'text-[var(--color-ink-muted)]' };

export function getStatusColors(status: string | undefined): { dot: string; text: string } {
  if (!status) return OFFLINE_COLORS;
  return STATUS_COLORS[status] || OFFLINE_COLORS;
}

export function getStatusI18nKey(status: string): string {
  const map: Record<string, string> = {
    online: 'status_online',
    away: 'status_away',
  };
  return map[status] || 'status_offline';
}
