const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  available: { dot: 'bg-accent-green', text: 'text-accent-green' },
  break: { dot: 'bg-accent-amber', text: 'text-accent-amber' },
  lunch: { dot: 'bg-accent-orange', text: 'text-accent-orange' },
  meeting: { dot: 'bg-accent-red', text: 'text-accent-red' },
  training: { dot: 'bg-accent-blue', text: 'text-accent-blue' },
};

const OFFLINE_COLORS = { dot: 'bg-text-muted', text: 'text-text-muted' };

export function getStatusColors(status: string | undefined): { dot: string; text: string } {
  if (!status) return OFFLINE_COLORS;
  return STATUS_COLORS[status] || OFFLINE_COLORS;
}

export function getStatusI18nKey(status: string): string {
  const map: Record<string, string> = {
    available: 'status_available',
    break: 'status_break',
    lunch: 'status_lunch',
    meeting: 'status_meeting',
    training: 'status_training',
  };
  return map[status] || 'status_offline';
}
