import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, slaBreaches } from '../../db/schema.js';
import { and, eq, desc, lt, isNull, isNotNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { computeSlaState, type DepartmentSlaConfig } from '../../services/sla.js';
import { resolveSchedule, type BusinessHoursSchedule } from '../../services/businessHours.js';
import { loadTicketForUser } from '../../services/membership.js';

export const slaRouter = router({
  getTicketState: protectedProcedure
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      // Tenant isolation via shared helper: throws NOT_FOUND or FORBIDDEN.
      // No operator bypass — operators must have entered the partner.
      const ticket = await loadTicketForUser(input.ticketId, ctx);

      const [partner] = await db.select({
        departments: partners.departments,
        businessHoursSchedule: partners.businessHoursSchedule,
      }).from(partners).where(eq(partners.id, ticket.partnerId));
      if (!partner) throw new TRPCError({ code: 'NOT_FOUND' });

      const departments = (partner.departments ?? []) as Array<{ id: string; sla?: DepartmentSlaConfig }>;
      const dept = departments.find((d) => d.id === ticket.dept);

      return computeSlaState({
        ticketCreatedAt: ticket.createdAt,
        firstStaffResponseAt: ticket.firstStaffResponseAt,
        sla: dept?.sla,
        schedule: resolveSchedule({ businessHoursSchedule: partner.businessHoursSchedule as BusinessHoursSchedule | null }),
        now: new Date(),
      });
    }),

  listBreaches: adminProcedure
    .input(z.object({
      status: z.enum(['active', 'resolved']).default('active'),
      limit: z.number().int().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST' });

      const filters = [eq(slaBreaches.partnerId, partnerId)];
      filters.push(input.status === 'active' ? isNull(slaBreaches.resolvedAt) : isNotNull(slaBreaches.resolvedAt));
      if (input.cursor) filters.push(lt(slaBreaches.breachedAt, input.cursor));

      const rows = await db.select().from(slaBreaches)
        .where(and(...filters))
        .orderBy(desc(slaBreaches.breachedAt))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1].breachedAt : undefined;
      return { items, nextCursor };
    }),
});
