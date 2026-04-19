import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db.js';
import { tickets, slaBreaches, partners, topicAlerts } from '../db/schema.js';
import {
  slaResolutionsTotal,
  slaFirstResponseMinutes,
  slaBreachesTotal,
  slaSweepRunsTotal,
  slaSweepDurationSeconds,
} from '../utils/metrics.js';
import logger from '../utils/logger.js';
import { resolveSchedule, type BusinessHoursSchedule, type BusinessHoursDayKey } from './businessHours.js';
import type { Server } from 'socket.io';

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

export type StaffResponseInput = {
  ticketId: string;
  at: string;
  senderRole: string;
  isWhisper: boolean;
};

export type StaffResponseResult = {
  stamped: boolean;
  resolvedBreach: boolean;
  partnerId?: string;
  department?: string;
  respondedInMinutes?: number;
};

const STAFF_ROLES = new Set(['support', 'admin', 'platform_operator']);

export async function markFirstStaffResponse(input: StaffResponseInput): Promise<StaffResponseResult> {
  if (input.isWhisper) return { stamped: false, resolvedBreach: false };
  if (!STAFF_ROLES.has(input.senderRole)) return { stamped: false, resolvedBreach: false };

  const updated = await db.update(tickets)
    .set({ firstStaffResponseAt: input.at })
    .where(and(eq(tickets.id, input.ticketId), isNull(tickets.firstStaffResponseAt)))
    .returning({ partnerId: tickets.partnerId, dept: tickets.dept, createdAt: tickets.createdAt });

  if (updated.length === 0) return { stamped: false, resolvedBreach: false };

  const { partnerId, dept, createdAt } = updated[0];

  const resolvedRows = await db.update(slaBreaches)
    .set({ resolvedAt: input.at, resolvedReason: 'first_response' })
    .where(and(eq(slaBreaches.ticketId, input.ticketId), isNull(slaBreaches.resolvedAt)))
    .returning({ id: slaBreaches.id });

  const resolvedBreach = resolvedRows.length > 0;
  if (resolvedBreach) {
    slaResolutionsTotal.inc({ partner_id: partnerId, department: dept });
  }

  const createdMs = new Date(createdAt).getTime();
  const respondedInMinutes = Math.max(0, Math.round((new Date(input.at).getTime() - createdMs) / 60_000));
  slaFirstResponseMinutes.observe({ partner_id: partnerId, department: dept }, respondedInMinutes);

  logger.info({ ticketId: input.ticketId, partnerId, dept, resolvedBreach }, '[sla] first staff response stamped');

  return { stamped: true, resolvedBreach, partnerId, department: dept, respondedInMinutes };
}

// ─── SLA sweep ──────────────────────────────────────────────────────────────

let io: Server | null = null;
export function setSlaIo(socketIo: Server) { io = socketIo; }

export type SweepSummary = {
  partnersChecked: number;
  ticketsChecked: number;
  breachesInserted: number;
};

type DepartmentRecord = { id: string; name: string; sla?: DepartmentSlaConfig };

export async function runSlaSweep(now: Date = new Date()): Promise<SweepSummary> {
  const endTimer = slaSweepDurationSeconds.startTimer();
  const summary: SweepSummary = { partnersChecked: 0, ticketsChecked: 0, breachesInserted: 0 };

  try {
    const activePartners = await db.select().from(partners).where(eq(partners.status, 'active'));

    for (const partner of activePartners as Array<{
      id: string;
      departments: DepartmentRecord[] | null;
      businessHoursSchedule?: BusinessHoursSchedule | null;
    }>) {
      summary.partnersChecked++;
      const departments = (partner.departments ?? []) as DepartmentRecord[];
      const slaDepts = departments.filter((d) => d.sla?.enabled);
      if (slaDepts.length === 0) continue;

      const schedule = resolveSchedule(partner);

      // Only sweep tickets that could still be resolved by a staff reply.
      // Closed/resolved tickets stay out — the partial index
      // `idx_tickets_open_unresponded` is gated on the same predicate.
      const openTickets = await db.select({
        id: tickets.id,
        dept: tickets.dept,
        createdAt: tickets.createdAt,
      })
        .from(tickets)
        .where(and(
          eq(tickets.partnerId, partner.id),
          inArray(tickets.status, ['open', 'pending']),
          isNull(tickets.firstStaffResponseAt),
        ));

      for (const ticket of openTickets as Array<{ id: string; dept: string; createdAt: string }>) {
        summary.ticketsChecked++;
        const dept = slaDepts.find((d) => d.id === ticket.dept);
        if (!dept || !dept.sla) continue;

        const state = computeSlaState({
          ticketCreatedAt: ticket.createdAt,
          firstStaffResponseAt: null,
          sla: dept.sla,
          schedule,
          now,
        });

        if (state.status !== 'breached') continue;

        // Idempotent insert keyed off unique(ticket_id). onConflictDoNothing
        // → returning() gives us [] on conflict, one row on fresh insert.
        const inserted = await db.insert(slaBreaches).values({
          id: `sla_${crypto.randomUUID()}`,
          ticketId: ticket.id,
          partnerId: partner.id,
          dept: ticket.dept,
          thresholdMinutes: dept.sla.firstResponseMinutes,
          breachedAt: now.toISOString(),
        }).onConflictDoNothing({ target: slaBreaches.ticketId }).returning({ id: slaBreaches.id });

        if (inserted.length > 0) {
          summary.breachesInserted++;
          slaBreachesTotal.inc({ partner_id: partner.id, department: ticket.dept });

          // Denormalized projection into topic_alerts (spec §Data Model).
          await db.insert(topicAlerts).values({
            id: `alert_sla_${crypto.randomUUID()}`,
            partnerId: partner.id,
            dept: ticket.dept,
            topic: 'SLA breach',
            summary: `Ticket ${ticket.id} exceeded ${dept.sla.firstResponseMinutes}m first-response SLA by ${state.overdueMinutes}m`,
            severity: 'high',
            ticketCount: 1,
            status: 'active',
          }).onConflictDoNothing();

          // Socket broadcast — short-circuits when io is null (tests that
          // don't opt-in via setSlaIo never hit emit).
          io?.to(`ticket:${ticket.id}`).emit('sla:breach', {
            ticketId: ticket.id,
            partnerId: partner.id,
            department: ticket.dept,
            overdueMinutes: state.overdueMinutes,
          });

          logger.info(
            { ticketId: ticket.id, partnerId: partner.id, dept: ticket.dept, overdueMinutes: state.overdueMinutes },
            '[sla] breach recorded',
          );
        }
      }
    }

    slaSweepRunsTotal.inc();
    return summary;
  } finally {
    endTimer();
  }
}
