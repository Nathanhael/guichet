export const safeDate = (date: string | number | Date | null | undefined): Date | null => {
  if (!date) return null;
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
