import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, tickets } from '../../db/schema.js';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { getAvailability } from '../../services/availability/index.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
import { assertMembership } from '../../services/membership.js';
import type { UserRole } from '../../types/index.js';
import logger from '../../utils/logger.js';
import {
  queueUnclaimedByLang,
  queueOldestUnclaimedSeconds,
  queueStaffingImbalance,
} from '../../utils/metrics.js';

export interface ImbalanceInput {
  online: number;
  waiting: number;
  oldestWaitMinutes: number;
}

export type ImbalanceLevel = 'ok' | 'thin' | 'critical';

/**
 * Heuristic from the routing spec. Critical = zero staffing AND (>=3 waiting
 * OR oldest wait exceeds 5 minutes). Thin = severely outnumbered (>=1:10) OR
 * zero staffing with a light queue still in the green window. Otherwise ok.
 */
export function classifyImbalance(input: ImbalanceInput): ImbalanceLevel {
  const { online, waiting, oldestWaitMinutes } = input;
  if (waiting === 0) return 'ok';
  if (online === 0) {
    if (waiting >= 3 || oldestWaitMinutes > 5) return 'critical';
    return 'thin';
  }
  const ratio = waiting / online;
  if (ratio >= 10) return 'thin';
  return 'ok';
}

const SUPPORTED_LANGS = ['nl', 'fr', 'en'] as const;
type SupportedLang = typeof SUPPORTED_LANGS[number];

export interface StaffingRow {
  lang: SupportedLang;
  onlineSupport: number;
  unclaimedTickets: number;
  oldestWaitMinutes: number | null;
  imbalanceLevel: ImbalanceLevel;
}

export const supportRouter = router({
  getStaffingByLanguage: roleProcedure(['support', 'admin'])
    .input(z.object({ partnerId: z.string() }))
    .query(async ({ input, ctx }): Promise<StaffingRow[]> => {
      await assertMembership(ctx.user.id, input.partnerId, !!ctx.user.isPlatformOperator);

      const partner = await db.select().from(partners).where(eq(partners.id, input.partnerId)).limit(1);
      if (partner.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'partner not found' });
      }
      const flags = (partner[0].aiFeatures as Record<string, unknown>) || {};
      if (flags.queueLangAwareness !== true) return [];

      const online = await getAvailability().advanced.onlineUsers(input.partnerId);
      const staffByLang: Record<SupportedLang, number> = { nl: 0, fr: 0, en: 0 };
      for (const u of online) {
        if (!canUseSupportWorkflows(u.role as UserRole, false)) continue;
        const lang = (u as { lang?: string }).lang as SupportedLang | undefined;
        if (lang && SUPPORTED_LANGS.includes(lang)) staffByLang[lang] += 1;
      }

      // Use queueEnteredAt (not createdAt) so staffing-imbalance signals
      // reflect time-since-last-queue-entry, matching how the queue itself
      // is ordered. A ticket that bounced through a brief support touch
      // shouldn't inflate "oldest waiting" with its pre-touch age.
      const openTickets = await db.select({
        agentLang: tickets.agentLang,
        queueEnteredAt: tickets.queueEnteredAt,
      }).from(tickets).where(and(
        eq(tickets.partnerId, input.partnerId),
        isNull(tickets.supportId),
        inArray(tickets.status, ['open', 'pending']),
      ));

      const now = Date.now();
      const rowsByLang: Record<SupportedLang, { count: number; oldestMinutes: number; totalMinutes: number }> = {
        nl: { count: 0, oldestMinutes: 0, totalMinutes: 0 },
        fr: { count: 0, oldestMinutes: 0, totalMinutes: 0 },
        en: { count: 0, oldestMinutes: 0, totalMinutes: 0 },
      };
      for (const t of openTickets) {
        const lang = (t.agentLang as SupportedLang | null) ?? 'en';
        if (!SUPPORTED_LANGS.includes(lang)) continue;
        const ageMinutes = Math.max(0, Math.floor((now - new Date(t.queueEnteredAt).getTime()) / 60_000));
        rowsByLang[lang].count += 1;
        rowsByLang[lang].oldestMinutes = Math.max(rowsByLang[lang].oldestMinutes, ageMinutes);
        rowsByLang[lang].totalMinutes += ageMinutes;
      }

      const result: StaffingRow[] = SUPPORTED_LANGS.map((lang) => {
        const waiting = rowsByLang[lang].count;
        const oldest = rowsByLang[lang].oldestMinutes;
        return {
          lang,
          onlineSupport: staffByLang[lang],
          unclaimedTickets: waiting,
          oldestWaitMinutes: waiting > 0 ? oldest : null,
          imbalanceLevel: classifyImbalance({ online: staffByLang[lang], waiting, oldestWaitMinutes: oldest }),
        };
      });

      const levelCode: Record<ImbalanceLevel, number> = { ok: 0, thin: 1, critical: 2 };
      for (const row of result) {
        queueUnclaimedByLang.set({ partner_id: input.partnerId, lang: row.lang }, row.unclaimedTickets);
        const oldestSeconds = rowsByLang[row.lang].oldestMinutes * 60;
        queueOldestUnclaimedSeconds.set({ partner_id: input.partnerId, lang: row.lang }, oldestSeconds);
        queueStaffingImbalance.set({ partner_id: input.partnerId, lang: row.lang }, levelCode[row.imbalanceLevel]);
      }

      logger.debug({ partnerId: input.partnerId, result }, '[support.getStaffingByLanguage]');
      return result;
    }),
});
