import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db.js';
import { tickets, slaBreaches, partners } from '../../db/schema.js';
import logger from '../../utils/logger.js';
import config from '../../config.js';
import type { BusinessHoursSchedule } from '../businessHours.js';
import { computeSlaState } from './compute.js';
import { extractPartnerSlaContext } from './partnerContext.js';
import type { SlaBreachBroadcaster } from './port.js';

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

export type SweepSummary = {
  partnersChecked: number;
  ticketsChecked: number;
  breachesInserted: number;
};

export interface SlaSweeper {
  runSweep(now?: Date): Promise<SweepSummary>;
  markFirstStaffResponse(input: StaffResponseInput): Promise<StaffResponseResult>;
  scheduleSweep(): () => void;
}

const STAFF_ROLES = new Set(['support', 'admin', 'platform_operator']);

export function createSlaSweeper(deps: { broadcaster: SlaBreachBroadcaster }): SlaSweeper {
  const { broadcaster } = deps;

  async function markFirstStaffResponse(input: StaffResponseInput): Promise<StaffResponseResult> {
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

    const createdMs = new Date(createdAt).getTime();
    const respondedInMinutes = Math.max(0, Math.round((new Date(input.at).getTime() - createdMs) / 60_000));

    logger.info({ ticketId: input.ticketId, partnerId, dept, resolvedBreach }, '[sla] first staff response stamped');

    return { stamped: true, resolvedBreach, partnerId, department: dept, respondedInMinutes };
  }

  async function runSweep(now: Date = new Date()): Promise<SweepSummary> {
    const summary: SweepSummary = { partnersChecked: 0, ticketsChecked: 0, breachesInserted: 0 };

    const activePartners = await db.select().from(partners).where(eq(partners.status, 'active'));

    for (const partner of activePartners as Array<{
      id: string;
      departments: unknown;
      businessHoursSchedule?: BusinessHoursSchedule | null;
    }>) {
      summary.partnersChecked++;
      const { slaMap, schedule } = extractPartnerSlaContext(partner);
      if (slaMap.size === 0) continue;

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
        const sla = slaMap.get(ticket.dept);
        if (!sla) continue;

        const state = computeSlaState({
          ticketCreatedAt: ticket.createdAt,
          firstStaffResponseAt: null,
          sla,
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
          thresholdMinutes: sla.firstResponseMinutes,
          breachedAt: now.toISOString(),
        }).onConflictDoNothing({ target: slaBreaches.ticketId }).returning({ id: slaBreaches.id });

        if (inserted.length > 0) {
          summary.breachesInserted++;

          broadcaster.emitBreach({
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

    return summary;
  }

  function scheduleSweep(): () => void {
    const intervalMs = config.SLA_SWEEP_INTERVAL_MS;
    if (intervalMs === 0) {
      logger.warn('[sla] SLA_SWEEP_INTERVAL_MS=0 — sweep disabled');
      return () => {};
    }

    let cancelled = false;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      try {
        const summary = await runSweep();
        logger.info(summary, '[sla] sweep complete');
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[sla] sweep failed');
      } finally {
        if (!cancelled) nextTimer = setTimeout(tick, intervalMs);
      }
    }

    nextTimer = setTimeout(tick, 30_000);
    logger.info({ intervalMs }, '[sla] sweep scheduler armed');

    return () => {
      cancelled = true;
      if (nextTimer) clearTimeout(nextTimer);
    };
  }

  return { runSweep, markFirstStaffResponse, scheduleSweep };
}
