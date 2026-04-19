import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import type { BusinessHoursSchedule, BusinessHoursDayKey } from './businessHours.js';

export interface DepartmentSlaConfig {
  enabled: boolean;
  firstResponseMinutes: number;
  warnAtPercent: number;
}

export interface ComputeSlaInput {
  ticketCreatedAt: string;
  firstStaffResponseAt: string | null;
  sla: DepartmentSlaConfig | undefined;
  schedule: BusinessHoursSchedule;
  now: Date;
}

export type SlaState =
  | { status: 'disabled' }
  | { status: 'met'; respondedInMinutes: number }
  | { status: 'ok'; elapsedMinutes: number; remainingMinutes: number }
  | { status: 'warning'; elapsedMinutes: number; remainingMinutes: number }
  | { status: 'breached'; overdueMinutes: number };

const DAY_KEYS: BusinessHoursDayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseHM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function elapsedBusinessMinutes(
  from: Date,
  to: Date,
  schedule: BusinessHoursSchedule,
): number {
  if (to <= from) return 0;
  let total = 0;
  const SLICE_MIN = 1;
  let cursor = new Date(from.getTime());
  while (cursor < to) {
    const zoned = toZonedTime(cursor, schedule.timezone);
    const dayKey = DAY_KEYS[zoned.getDay()];
    const day = schedule.weekly[dayKey];
    if (day && !day.closed) {
      const localDate = formatInTimeZone(cursor, schedule.timezone, 'yyyy-MM-dd');
      const exception = schedule.exceptions.find((ex) => ex.date === localDate);
      const windows = exception
        ? (exception.closed ? [] : (exception.windows ?? []))
        : day.windows;
      const currentMin = zoned.getHours() * 60 + zoned.getMinutes();
      const inWindow = windows.some((w) => {
        const s = parseHM(w.start);
        const e = parseHM(w.end);
        return e > s ? currentMin >= s && currentMin < e : currentMin >= s || currentMin < e;
      });
      if (inWindow) total += SLICE_MIN;
    }
    cursor = new Date(cursor.getTime() + SLICE_MIN * 60_000);
  }
  return total;
}

export function computeSlaState(input: ComputeSlaInput): SlaState {
  if (!input.sla?.enabled) return { status: 'disabled' };

  const created = new Date(input.ticketCreatedAt);
  const threshold = input.sla.firstResponseMinutes;

  if (input.firstStaffResponseAt) {
    const responded = elapsedBusinessMinutes(created, new Date(input.firstStaffResponseAt), input.schedule);
    return { status: 'met', respondedInMinutes: responded };
  }

  const elapsed = elapsedBusinessMinutes(created, input.now, input.schedule);

  if (elapsed >= threshold) {
    return { status: 'breached', overdueMinutes: elapsed - threshold };
  }

  const warnAt = Math.floor((threshold * input.sla.warnAtPercent) / 100);
  const remaining = threshold - elapsed;
  if (elapsed >= warnAt) return { status: 'warning', elapsedMinutes: elapsed, remainingMinutes: remaining };
  return { status: 'ok', elapsedMinutes: elapsed, remainingMinutes: remaining };
}
