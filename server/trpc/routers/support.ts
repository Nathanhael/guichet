import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, tickets, memberships } from '../../db/schema.js';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { getOnlineUsersForPartner } from '../../services/presence.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
import type { UserRole } from '../../types/index.js';
import logger from '../../utils/logger.js';

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
  if (ratio <= 5) return 'ok';
  return 'ok';
}

const SUPPORTED_LANGS = ['nl', 'fr', 'en'] as const;
type SupportedLang = typeof SUPPORTED_LANGS[number];

export interface StaffingRow {
  lang: SupportedLang;
  onlineSupport: number;
  unclaimedTickets: number;
  averageWaitMinutes: number | null;
  imbalanceLevel: ImbalanceLevel;
}

async function assertMembership(userId: string, partnerId: string, isPlatformOperator: boolean): Promise<void> {
  if (isPlatformOperator) return;
  const rows = await db.select().from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, partnerId)))
    .limit(1);
  if (rows.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'not a member of this partner' });
  }
}

export const supportRouter = router({
  getStaffingByLanguage: protectedProcedure
    .input(z.object({ partnerId: z.string() }))
    .query(async ({ input, ctx }): Promise<StaffingRow[]> => {
      await assertMembership(ctx.user.id, input.partnerId, !!ctx.user.isPlatformOperator);

      const partner = await db.select().from(partners).where(eq(partners.id, input.partnerId)).limit(1);
      if (partner.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'partner not found' });
      }
      const flags = (partner[0].aiFeatures as Record<string, unknown>) || {};
      if (flags.queueLangAwareness !== true) return [];

      const online = await getOnlineUsersForPartner(input.partnerId);
      const staffByLang: Record<SupportedLang, number> = { nl: 0, fr: 0, en: 0 };
      for (const u of online) {
        if (!canUseSupportWorkflows(u.role as UserRole, false)) continue;
        const lang = (u as { lang?: string }).lang as SupportedLang | undefined;
        if (lang && SUPPORTED_LANGS.includes(lang)) staffByLang[lang] += 1;
      }

      const openTickets = await db.select({
        agentLang: tickets.agentLang,
        createdAt: tickets.createdAt,
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
        const ageMinutes = Math.max(0, Math.floor((now - new Date(t.createdAt).getTime()) / 60_000));
        rowsByLang[lang].count += 1;
        rowsByLang[lang].oldestMinutes = Math.max(rowsByLang[lang].oldestMinutes, ageMinutes);
        rowsByLang[lang].totalMinutes += ageMinutes;
      }

      const result: StaffingRow[] = SUPPORTED_LANGS.map((lang) => {
        const waiting = rowsByLang[lang].count;
        const oldest = rowsByLang[lang].oldestMinutes;
        const avg = waiting > 0 ? Math.round(rowsByLang[lang].totalMinutes / waiting) : null;
        return {
          lang,
          onlineSupport: staffByLang[lang],
          unclaimedTickets: waiting,
          averageWaitMinutes: avg,
          imbalanceLevel: classifyImbalance({ online: staffByLang[lang], waiting, oldestWaitMinutes: oldest }),
        };
      });

      logger.debug({ partnerId: input.partnerId, result }, '[support.getStaffingByLanguage]');
      return result;
    }),
});
