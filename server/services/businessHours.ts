import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { Server } from 'socket.io';
import config from '../config.js';
import { query } from '../db.js';
import logger from '../utils/logger.js';

let io: Server | null = null;

export function setIo(socketIo: Server) {
  io = socketIo;
}

export type BusinessHoursDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface BusinessHoursWindow {
  start: string;
  end: string;
}

export interface BusinessHoursDaySchedule {
  closed: boolean;
  windows: BusinessHoursWindow[];
}

export interface BusinessHoursException {
  id: string;
  date: string;
  closed?: boolean;
  windows?: BusinessHoursWindow[];
  note?: string;
}

export interface BusinessHoursSchedule {
  version: 1;
  timezone: string;
  weekly: Record<BusinessHoursDayKey, BusinessHoursDaySchedule>;
  exceptions: BusinessHoursException[];
}

export interface BusinessHoursStatus {
  isOpen: boolean;
  timezone: string;
  source: 'weekly' | 'exception' | 'default';
  matchedWindow?: BusinessHoursWindow;
  activeExceptionNote?: string;
  nextOpenAt?: string;
  nextCloseAt?: string;
  evaluatedAt: string;
  message?: string;
}

const DAY_KEYS: BusinessHoursDayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_KEYS: BusinessHoursDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
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

function startOfToday(now: Date) {
  return now.getHours() * 60 + now.getMinutes();
}

function weekdayKey(now: Date): BusinessHoursDayKey {
  return DAY_KEYS[now.getDay()] ?? 'mon';
}

function buildDefaultSchedule(): BusinessHoursSchedule {
  const defaultWindow = {
    start: config.BUSINESS_HOURS_START,
    end: config.BUSINESS_HOURS_END,
  };

  return {
    version: 1,
    timezone: 'Europe/Brussels',
    weekly: {
      mon: { closed: false, windows: [defaultWindow] },
      tue: { closed: false, windows: [defaultWindow] },
      wed: { closed: false, windows: [defaultWindow] },
      thu: { closed: false, windows: [defaultWindow] },
      fri: { closed: false, windows: [defaultWindow] },
      sat: { closed: true, windows: [] },
      sun: { closed: true, windows: [] },
    },
    exceptions: [],
  };
}

function normalizeSchedule(schedule?: BusinessHoursSchedule | null): BusinessHoursSchedule {
  const fallback = buildDefaultSchedule();
  if (!schedule) return fallback;

  return {
    version: 1,
    timezone: isValidTimezone(schedule.timezone) ? schedule.timezone : fallback.timezone,
    weekly: WEEKDAY_KEYS.reduce((acc, key) => {
      const value = schedule.weekly?.[key];
      acc[key] = value
        ? { closed: !!value.closed, windows: value.windows ?? [] }
        : fallback.weekly[key];
      return acc;
    }, {} as Record<BusinessHoursDayKey, BusinessHoursDaySchedule>),
    exceptions: schedule.exceptions ?? [],
  };
}

function fromLegacyBusinessHours(partner?: {
  businessHoursStart?: string | null;
  businessHoursEnd?: string | null;
  businessHoursTimezone?: string | null;
  businessHoursSchedule?: BusinessHoursSchedule | null;
}): BusinessHoursSchedule {
  if (partner?.businessHoursSchedule) {
    return normalizeSchedule(partner.businessHoursSchedule);
  }

  if (!partner?.businessHoursStart || !partner?.businessHoursEnd) {
    return buildDefaultSchedule();
  }

  const timezone = partner.businessHoursTimezone && isValidTimezone(partner.businessHoursTimezone)
    ? partner.businessHoursTimezone
    : 'Europe/Brussels';

  const schedule = buildDefaultSchedule();
  schedule.timezone = timezone;
  schedule.weekly = WEEKDAY_KEYS.reduce((acc, key) => {
    acc[key] = {
      closed: key === 'sat' || key === 'sun',
      windows: key === 'sat' || key === 'sun'
        ? []
        : [{ start: partner.businessHoursStart!, end: partner.businessHoursEnd! }],
    };
    return acc;
  }, {} as Record<BusinessHoursDayKey, BusinessHoursDaySchedule>);

  return schedule;
}

function windowsForDate(schedule: BusinessHoursSchedule, now: Date) {
  const localDate = formatInTimeZone(now, schedule.timezone, 'yyyy-MM-dd');
  const exception = schedule.exceptions.find((item) => item.date === localDate);
  if (exception) {
    return {
      source: 'exception' as const,
      windows: exception.closed ? [] : (exception.windows ?? []),
      note: exception.note,
    };
  }

  const day = weekdayKey(toZonedTime(now, schedule.timezone));
  const daySchedule = schedule.weekly[day];
  return {
    source: 'weekly' as const,
    windows: daySchedule?.closed ? [] : (daySchedule?.windows ?? []),
    note: undefined,
  };
}

function statusMessage(status: Pick<BusinessHoursStatus, 'isOpen' | 'nextOpenAt' | 'nextCloseAt' | 'timezone' | 'activeExceptionNote'>) {
  if (status.isOpen) {
    return status.nextCloseAt
      ? `Support is open. Closes at ${formatInTimeZone(status.nextCloseAt, status.timezone, 'EEE HH:mm')}.`
      : 'Support is open.';
  }

  return status.nextOpenAt
    ? `Support is currently closed. Reopens at ${formatInTimeZone(status.nextOpenAt, status.timezone, 'EEE HH:mm')}.`
    : 'Support is currently closed.';
}

function nextBoundary(schedule: BusinessHoursSchedule, now: Date, kind: 'open' | 'close') {
  const zonedNow = toZonedTime(now, schedule.timezone);
  const currentMinutes = startOfToday(zonedNow);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const zonedCandidate = toZonedTime(candidate, schedule.timezone);
    const dayKey = weekdayKey(zonedCandidate);
    const localDate = formatInTimeZone(candidate, schedule.timezone, 'yyyy-MM-dd');
    const exception = schedule.exceptions.find((item) => item.date === localDate);
    const windows = exception
      ? (exception.closed ? [] : (exception.windows ?? []))
      : (schedule.weekly[dayKey]?.closed ? [] : (schedule.weekly[dayKey]?.windows ?? []));

    for (const window of windows) {
      const startMinutes = parseMinutes(window.start);
      const endMinutes = parseMinutes(window.end);
      const overnight = endMinutes <= startMinutes;
      const boundaryMinutes = kind === 'open' ? startMinutes : endMinutes;
      const dayOffset = offset + (kind === 'close' && overnight ? 1 : 0);

      if (offset === 0 && boundaryMinutes <= currentMinutes && !(kind === 'close' && overnight)) {
        continue;
      }

      const boundaryDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const boundaryIso = formatInTimeZone(boundaryDate, schedule.timezone, 'yyyy-MM-dd');
      return `${boundaryIso}T${minutesToTime(boundaryMinutes)}:00`;
    }
  }

  return undefined;
}

export function getBusinessHoursStatus(partner?: {
  businessHoursStart?: string | null;
  businessHoursEnd?: string | null;
  businessHoursTimezone?: string | null;
  businessHoursSchedule?: BusinessHoursSchedule | null;
}, now = new Date()): BusinessHoursStatus {
  const schedule = fromLegacyBusinessHours(partner);
  const zonedNow = toZonedTime(now, schedule.timezone);
  const currentMinutes = startOfToday(zonedNow);
  const todayWindows = windowsForDate(schedule, now);

  let matchedWindow: BusinessHoursWindow | undefined;
  for (const window of todayWindows.windows) {
    const startMinutes = parseMinutes(window.start);
    const endMinutes = parseMinutes(window.end);
    const isOvernight = endMinutes <= startMinutes;
    const isOpen = isOvernight
      ? currentMinutes >= startMinutes || currentMinutes < endMinutes
      : currentMinutes >= startMinutes && currentMinutes < endMinutes;

    if (isOpen) {
      matchedWindow = window;
      break;
    }
  }

  const status: BusinessHoursStatus = {
    isOpen: !!matchedWindow,
    timezone: schedule.timezone,
    source: todayWindows.source,
    matchedWindow,
    activeExceptionNote: todayWindows.source === 'exception' ? todayWindows.note : undefined,
    evaluatedAt: now.toISOString(),
    nextOpenAt: matchedWindow ? undefined : nextBoundary(schedule, now, 'open'),
    nextCloseAt: matchedWindow ? nextBoundary(schedule, now, 'close') : undefined,
  };

  status.message = statusMessage(status);
  return status;
}

export function isWithinBusinessHours(partner?: {
  businessHoursStart?: string | null;
  businessHoursEnd?: string | null;
  businessHoursTimezone?: string | null;
  businessHoursSchedule?: BusinessHoursSchedule | null;
}): boolean {
  return getBusinessHoursStatus(partner).isOpen;
}

export async function broadcastAgentStatus(agentId: string, online: boolean) {
  try {
    if (!io) return;
    const openTickets = await query('SELECT id FROM tickets WHERE agent_id = $1 AND status != $2', [agentId, 'closed']) as { id: string }[];
    for (const ticket of openTickets) io.to(`ticket:${ticket.id}`).emit('agent:status', { ticketId: ticket.id, agentId, online });
  } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[agent:status] error'); }
}

export async function broadcastQueuePositions(partnerId?: string) {
  try {
    if (!io) return;
    let openTickets: { id: string }[];
    if (partnerId) {
      // Scoped: only broadcast within a single partner
      openTickets = await query('SELECT id FROM tickets WHERE status = $1 AND support_id IS NULL AND partner_id = $2 ORDER BY created_at ASC', ['open', partnerId]) as { id: string }[];
    } else {
      // Fallback: broadcast per-partner to avoid cross-tenant leakage
      const partnerIds = await query('SELECT DISTINCT partner_id FROM tickets WHERE status = $1 AND support_id IS NULL', ['open']) as { partner_id: string }[];
      for (const p of partnerIds) {
        await broadcastQueuePositions(p.partner_id);
      }
      return;
    }
    openTickets.forEach((t, index) => {
      const position = index + 1;
      io!.to(`ticket:${t.id}`).emit('queue:update', { position, etaMins: position * 2 });
    });
  } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[broadcastQueuePositions] error'); }
}
