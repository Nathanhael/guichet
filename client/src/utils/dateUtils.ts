export const safeDate = (date: string | number | Date | null | undefined): Date | null => {
  if (!date) return null;
  // DB timestamps (mode: 'string') arrive without timezone suffix e.g. "2026-03-31 22:08:59.773".
  // Without 'Z', new Date() treats them as local time instead of UTC. Normalize before parsing.
  if (typeof date === 'string' && !date.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(date)) {
    date = date.replace(' ', 'T') + 'Z';
  }
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d;
};

export const formatDate = (date: string | number | Date | null | undefined, options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }, locale = 'en-GB'): string => {
  const d = safeDate(date);
  if (!d) return '—';
  return d.toLocaleTimeString(locale, options);
};

export const getTicketTime = (iso: string | undefined): string => {
  const d = safeDate(iso);
  if (!d) return '—';
  const today = new Date().toDateString() === d.toDateString();
  if (today) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Smart relative timestamp for sidebar ticket rows.
 * - Today: "15:05"
 * - Yesterday: "Yest 14:30"
 * - 2-6 days ago: "Mon 15:05"
 * - Older: "08 Mar"
 */
export const getSmartTimestamp = (iso: string | undefined): string => {
  const d = safeDate(iso);
  if (!d) return '—';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  if (diffDays === 0) return time;
  if (diffDays === 1) return `Yest ${time}`;
  if (diffDays >= 2 && diffDays <= 6) return `${DAY_NAMES[d.getDay()]} ${time}`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
