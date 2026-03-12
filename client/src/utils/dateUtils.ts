export const safeDate = (date: any): Date | null => {
  if (!date) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d;
};

export const formatDate = (date: any, options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }, locale = 'en-GB'): string => {
  const d = safeDate(date);
  if (!d) return '—';
  return d.toLocaleTimeString(locale, options);
};

export const formatFullDate = (date: any, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }, locale = 'en-GB'): string => {
  const d = safeDate(date);
  if (!d) return '—';
  return d.toLocaleString(locale, options);
};

export const isToday = (date: any): boolean => {
  const d = safeDate(date);
  if (!d) return false;
  return new Date().toDateString() === d.toDateString();
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
