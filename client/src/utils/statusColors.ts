const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  online: { dot: 'bg-accent-green', text: 'text-accent-green' },
  away: { dot: 'bg-accent-amber', text: 'text-accent-amber' },
};

const OFFLINE_COLORS = { dot: 'bg-text-muted', text: 'text-text-muted' };

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
