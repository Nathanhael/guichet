import {
  BusinessHoursDayKey,
  BusinessHoursException,
  BusinessHoursSchedule,
  BusinessHoursStatus,
  BusinessHoursWindow,
} from '../types';

export const BUSINESS_HOURS_DAY_ORDER: BusinessHoursDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const BUSINESS_HOURS_DAY_LABELS: Record<BusinessHoursDayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const WALL_CLOCK_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export function createDefaultBusinessHoursSchedule(timezone = 'Europe/Brussels'): BusinessHoursSchedule {
  return {
    version: 1,
    timezone,
    weekly: {
      mon: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      tue: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      wed: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      thu: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      fri: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      sat: { closed: true, windows: [] },
      sun: { closed: true, windows: [] },
    },
    exceptions: [],
  };
}

export function formatBusinessHoursTimestamp(value?: string, timezone?: string) {
  if (!value) return null;

  if (WALL_CLOCK_TIMESTAMP_PATTERN.test(value)) {
    const [datePart, timePart] = value.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    const weekday = new Date(year, month - 1, day).toLocaleDateString('en-GB', { weekday: 'short' });
    return `${weekday} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || 'Europe/Brussels',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export function getBusinessHoursSummary(status?: BusinessHoursStatus | null, t?: (key: string) => string) {
  if (!status) return t?.('bh_status_unavailable') ?? 'Business-hours status unavailable.';
  if (status.message && !t) return status.message;
  if (status.isOpen) return t?.('bh_status_open') ?? 'Support is open.';
  if (status.nextOpenAt) {
    const time = formatBusinessHoursTimestamp(status.nextOpenAt, status.timezone);
    const template = t?.('bh_status_closed_reopens') ?? 'Support is closed. Reopens {time}.';
    return template.replace('{time}', time ?? '');
  }
  return t?.('bh_status_closed') ?? 'Support is closed.';
}

export function getBusinessHoursReason(status?: BusinessHoursStatus | null) {
  if (!status?.activeExceptionNote) return null;
  return status.activeExceptionNote;
}

function parseMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getZonedParts(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, BusinessHoursDayKey> = {
    Sun: 'sun',
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
  };

  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    minutes: Number(byType.hour) * 60 + Number(byType.minute),
    weekday: weekdayMap[byType.weekday] ?? 'mon',
  };
}

function getWindowSet(schedule: BusinessHoursSchedule, date: string, weekday: BusinessHoursDayKey) {
  const exception = schedule.exceptions.find((item) => item.date === date);
  if (exception) {
    return {
      source: 'exception' as const,
      windows: exception.closed ? [] : (exception.windows ?? []),
      note: exception.note?.trim() || undefined,
    };
  }

  const daySchedule = schedule.weekly[weekday];
  return {
    source: 'weekly' as const,
    windows: daySchedule?.closed ? [] : (daySchedule?.windows ?? []),
    note: undefined,
  };
}

function buildBoundaryTimestamp(date: string, minutes: number) {
  return `${date}T${minutesToTime(minutes)}:00`;
}

function nextBoundary(schedule: BusinessHoursSchedule, now: Date, kind: 'open' | 'close') {
  const current = getZonedParts(now, schedule.timezone);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const zonedCandidate = getZonedParts(candidate, schedule.timezone);
    const windowSet = getWindowSet(schedule, zonedCandidate.date, zonedCandidate.weekday);

    for (const window of windowSet.windows) {
      const startMinutes = parseMinutes(window.start);
      const endMinutes = parseMinutes(window.end);
      const overnight = endMinutes <= startMinutes;
      const boundaryMinutes = kind === 'open' ? startMinutes : endMinutes;
      const boundaryOffset = offset + (kind === 'close' && overnight ? 1 : 0);

      if (offset === 0 && boundaryMinutes <= current.minutes && !(kind === 'close' && overnight)) {
        continue;
      }

      const boundaryDate = new Date(now.getTime() + boundaryOffset * 24 * 60 * 60 * 1000);
      const zonedBoundary = getZonedParts(boundaryDate, schedule.timezone);
      return buildBoundaryTimestamp(zonedBoundary.date, boundaryMinutes);
    }
  }

  return undefined;
}

export function evaluateBusinessHoursStatus(schedule: BusinessHoursSchedule, now = new Date()): BusinessHoursStatus {
  const current = getZonedParts(now, schedule.timezone);
  const windowSet = getWindowSet(schedule, current.date, current.weekday);

  let matchedWindow: BusinessHoursWindow | undefined;
  for (const window of windowSet.windows) {
    const startMinutes = parseMinutes(window.start);
    const endMinutes = parseMinutes(window.end);
    const overnight = endMinutes <= startMinutes;
    const isOpen = overnight
      ? current.minutes >= startMinutes || current.minutes < endMinutes
      : current.minutes >= startMinutes && current.minutes < endMinutes;

    if (isOpen) {
      matchedWindow = window;
      break;
    }
  }

  const status: BusinessHoursStatus = {
    isOpen: !!matchedWindow,
    timezone: schedule.timezone,
    source: windowSet.source,
    matchedWindow,
    activeExceptionNote: windowSet.source === 'exception' ? windowSet.note : undefined,
    nextOpenAt: matchedWindow ? undefined : nextBoundary(schedule, now, 'open'),
    nextCloseAt: matchedWindow ? nextBoundary(schedule, now, 'close') : undefined,
    evaluatedAt: now.toISOString(),
    message: undefined,
  };

  status.message = getBusinessHoursSummary(status);
  return status;
}

export function sortBusinessHoursExceptions(exceptions: BusinessHoursException[]) {
  return [...exceptions].sort((a, b) => {
    if (a.date === b.date) return a.id.localeCompare(b.id);
    return a.date.localeCompare(b.date);
  });
}

export function getBusinessHoursDraftIssues(schedule: BusinessHoursSchedule, t?: (key: string) => string) {
  const issues: string[] = [];
  const seenDates = new Set<string>();

  for (const exception of schedule.exceptions) {
    if (!exception.date) continue;
    if (seenDates.has(exception.date)) {
      const template = t?.('bh_duplicate_exception') ?? 'Duplicate exception date: {date}';
      issues.push(template.replace('{date}', exception.date));
    }
    seenDates.add(exception.date);
  }

  return issues;
}
