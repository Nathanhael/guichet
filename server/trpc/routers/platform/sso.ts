import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, partnerGroupMappings, auditLog } from '../../../db/schema.js';
import { eq, asc, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';

export const platformSsoRouter = router({
  listGroupMappings: platformProcedure
    .input(z.object({ partnerId: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const conditions = [];
      if (input?.partnerId) conditions.push(eq(partnerGroupMappings.partnerId, input.partnerId));

      const rows = await db
        .select({
          id: partnerGroupMappings.id,
          partnerId: partnerGroupMappings.partnerId,
          partnerName: partners.name,
          azureGroupId: partnerGroupMappings.azureGroupId,
          azureGroupName: partnerGroupMappings.azureGroupName,
          defaultRole: partnerGroupMappings.defaultRole,
          defaultDepartments: partnerGroupMappings.defaultDepartments,
          createdAt: partnerGroupMappings.createdAt,
        })
        .from(partnerGroupMappings)
        .innerJoin(partners, eq(partnerGroupMappings.partnerId, partners.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(partners.name), asc(partnerGroupMappings.azureGroupName));

      return rows;
    }),

  addGroupMapping: platformProcedure
    .input(z.object({
      partnerId: z.string(),
      azureGroupId: z.string().min(1),
      azureGroupName: z.string().optional(),
      defaultRole: z.enum(['agent', 'support', 'admin']).default('agent'),
      defaultDepartments: z.array(z.string()).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      const partner = await db.select({ id: partners.id })
        .from(partners).where(eq(partners.id, input.partnerId)).limit(1);
      if (partner.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

      if (input.defaultRole === 'support' && input.defaultDepartments.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department in group mapping' });
      }

      const id = randomUUID();
      try {
        await db.insert(partnerGroupMappings).values({
          id,
          partnerId: input.partnerId,
          azureGroupId: input.azureGroupId,
          azureGroupName: input.azureGroupName || null,
          defaultRole: input.defaultRole,
          defaultDepartments: input.defaultDepartments,
        });
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          throw new TRPCError({ code: 'CONFLICT', message: 'This Azure group is already mapped to this partner' });
        }
        throw err;
      }

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'sso.group_mapping_added',
        actorId: ctx.user.id,
        partnerId: input.partnerId,
        targetType: 'group_mapping',
        targetId: id,
        metadata: { azureGroupId: input.azureGroupId, defaultRole: input.defaultRole },
      });

      return { success: true, id };
    }),

  updateGroupMapping: platformProcedure
    .input(z.object({
      id: z.string(),
      azureGroupName: z.string().optional(),
      defaultRole: z.enum(['agent', 'support', 'admin']).optional(),
      defaultDepartments: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await db.select().from(partnerGroupMappings).where(eq(partnerGroupMappings.id, input.id)).limit(1);
      if (existing.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Mapping not found' });

      const effectiveRole = input.defaultRole ?? existing[0].defaultRole;
      const effectiveDepts = input.defaultDepartments ?? (existing[0].defaultDepartments as string[] || []);
      if (effectiveRole === 'support' && effectiveDepts.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department in group mapping' });
      }

      const updates: Record<string, unknown> = {};
      if (input.azureGroupName !== undefined) updates.azureGroupName = input.azureGroupName;
      if (input.defaultRole !== undefined) updates.defaultRole = input.defaultRole;
      if (input.defaultDepartments !== undefined) updates.defaultDepartments = input.defaultDepartments;

      if (Object.keys(updates).length > 0) {
        await db.update(partnerGroupMappings).set(updates).where(eq(partnerGroupMappings.id, input.id));
      }

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'sso.group_mapping_updated',
        actorId: ctx.user.id,
        partnerId: existing[0].partnerId,
        targetType: 'group_mapping',
        targetId: input.id,
        metadata: updates,
      });

      return { success: true };
    }),

  removeGroupMapping: platformProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      const existing = await db.select().from(partnerGroupMappings).where(eq(partnerGroupMappings.id, input)).limit(1);
      if (existing.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Mapping not found' });

      await db.delete(partnerGroupMappings).where(eq(partnerGroupMappings.id, input));

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'sso.group_mapping_removed',
        actorId: ctx.user.id,
        partnerId: existing[0].partnerId,
        targetType: 'group_mapping',
        targetId: input,
        metadata: { azureGroupId: existing[0].azureGroupId },
      });

      return { success: true };
    }),
});
