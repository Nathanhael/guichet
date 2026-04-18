import { z } from 'zod';
import { router, partnerAdminProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { auditLog, users } from '../../../db/schema.js';
import { eq, desc, gte, lte, and, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';

const PARTNER_ACTIONS = [
  'member.added',
  'member.invited',
  'member.removed',
  'member.updated',
  'partner.config_updated',
  'label.created',
  'kb.created',
  'webhook.created',
  'sso.membership_auto_created',
  'sso.role_synced',
  'sso.membership_revoked',
] as const;

const baseInput = z.object({
  action: z.string().optional(),
  actorId: z.string().optional(),
  targetType: z.string().optional(),
  wasExternal: z.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

function buildConditions(
  input: z.infer<typeof baseInput>,
  partnerId: string,
) {
  const conditions = [eq(auditLog.partnerId, partnerId)];
  if (input.action) conditions.push(eq(auditLog.action, input.action));
  if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
  if (input.targetType) conditions.push(eq(auditLog.targetType, input.targetType));
  if (input.dateFrom) conditions.push(gte(auditLog.createdAt, `${input.dateFrom}T00:00:00`));
  if (input.dateTo) conditions.push(lte(auditLog.createdAt, `${input.dateTo}T23:59:59.999`));
  if (input.wasExternal === true) {
    conditions.push(sql`${auditLog.metadata}->>'wasExternal' = 'true'`);
  }
  return conditions;
}

// Target types that the app emits on partner-scoped audit rows. Keep in sync
// with the `targetType` literals passed to db.insert(auditLog).values(...)
// for this tenant's actions (see `PARTNER_ACTIONS` above).
const PARTNER_TARGET_TYPES = [
  'user',
  'membership',
  'partner',
  'label',
  'kb_article',
  'webhook',
] as const;

export const partnerAuditRouter = router({
  listActions: partnerAdminProcedure.query(() => {
    return PARTNER_ACTIONS.slice();
  }),

  listTargetTypes: partnerAdminProcedure.query(() => {
    return PARTNER_TARGET_TYPES.slice();
  }),

  getAuditLog: partnerAdminProcedure
    .input(baseInput.extend({
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const conditions = buildConditions(input, ctx.user.partnerId);

        if (input.cursor) {
          const sepIdx = input.cursor.indexOf('|');
          if (sepIdx !== -1) {
            const cursorTime = input.cursor.slice(0, sepIdx);
            const cursorId = input.cursor.slice(sepIdx + 1);
            conditions.push(
              sql`(${auditLog.createdAt} < ${cursorTime} OR (${auditLog.createdAt} = ${cursorTime} AND ${auditLog.id} < ${cursorId}))`
            );
          }
        }

        const results = await db.select({
          id: auditLog.id,
          action: auditLog.action,
          actorId: auditLog.actorId,
          actorName: users.name,
          partnerId: auditLog.partnerId,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
          .from(auditLog)
          .leftJoin(users, eq(auditLog.actorId, users.id))
          .where(and(...conditions))
          .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
          .limit(input.limit + 1);

        const hasMore = results.length > input.limit;
        const items = hasMore ? results.slice(0, input.limit) : results;
        const lastItem = items[items.length - 1];
        const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

        return { items, nextCursor };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  exportAuditLog: partnerAdminProcedure
    .input(baseInput)
    .query(async ({ input, ctx }) => {
      try {
        const conditions = buildConditions(input, ctx.user.partnerId);

        return await db.select({
          id: auditLog.id,
          action: auditLog.action,
          actorId: auditLog.actorId,
          actorName: users.name,
          partnerId: auditLog.partnerId,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
          .from(auditLog)
          .leftJoin(users, eq(auditLog.actorId, users.id))
          .where(and(...conditions))
          .orderBy(desc(auditLog.createdAt))
          .limit(10000);
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});
