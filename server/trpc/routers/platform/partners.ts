import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, auditLog, tickets } from '../../../db/schema.js';
import { eq, asc, isNull, and, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import logger from '../../../utils/logger.js';
import { wrapError } from '../../../utils/trpcErrors.js';
import { broadcastPartnerDeactivation } from '../../../socket/handlers.js';
import { validateWebhookUrl } from '../../../services/webhookDispatch.js';
import { encrypt } from '../../../services/encryption.js';
import { type BusinessHoursSchedule } from '../../../services/businessHours.js';
import config from '../../../config.js';

// 24/7 schedule seeded for new partners. Admins personalize via AdminBusinessHours.
function buildOpenAlwaysSchedule(): BusinessHoursSchedule {
  const allDay = { start: '00:00', end: '23:59' };
  return {
    version: 1,
    timezone: 'Europe/Brussels',
    weekly: {
      mon: { closed: false, windows: [allDay] },
      tue: { closed: false, windows: [allDay] },
      wed: { closed: false, windows: [allDay] },
      thu: { closed: false, windows: [allDay] },
      fri: { closed: false, windows: [allDay] },
      sat: { closed: false, windows: [allDay] },
      sun: { closed: false, windows: [allDay] },
    },
    exceptions: [],
  };
}

export const platformPartnersRouter = router({
  listPartners: platformProcedure.query(async () => {
    try {
      const allPartners = await db.select().from(partners)
        .where(isNull(partners.deletedAt))
        .orderBy(asc(partners.name));
      return allPartners.map(({ aiConfig: _aiConfig, aiProvider: _aiProvider, aiModel: _aiModel, ...safe }) => safe);
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tRPC: listPartners error');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list partners' });
    }
  }),

  createPartner: platformProcedure
    .input(z.object({
      id: z.string().min(3).max(50),
      name: z.string().min(2),
      industry: z.string().default('Telecommunications'),
      departments: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional()
      })).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        await db.insert(partners).values({
          id: input.id,
          name: input.name,
          industry: input.industry,
          departments: input.departments,
          status: 'active',
          businessHoursSchedule: buildOpenAlwaysSchedule(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'partner.created',
          actorId: ctx.user.id,
          partnerId: input.id,
          targetType: 'partner',
          targetId: input.id,
          metadata: {
            industry: input.industry,
          },
        });

        return { success: true, id: input.id };
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Partner ID already exists' });
        }
        wrapError(err, 'create partner');
      }
    }),

  updatePartner: platformProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        name: z.string().optional(),
        industry: z.string().optional(),
        departments: z.array(z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          isActive: z.boolean().default(true)
        })).optional(),
        aiEnabled: z.boolean().optional(),
        aiFeatures: z.object({
          messageImprovement: z.enum(['off', 'optional', 'forced']).optional(),
          chatSummarization: z.boolean().optional(),
          translation: z.boolean().optional(),
          autoSummarizeOnClose: z.boolean().optional(),
          queueLangAwareness: z.boolean().optional(),
        }).optional(),
        aiConfig: z.object({
          baseUrl: z.string().url().optional(),
          apiKey: z.string().optional(),
          deployment: z.string().optional(),
        }).optional(),
        aiProvider: z.enum(['ollama', 'azure-openai', 'openai-compatible']).optional(),
        aiModel: z.string().optional(),
      })
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.data.aiConfig?.baseUrl) {
        try {
          await validateWebhookUrl(input.data.aiConfig.baseUrl);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `AI base URL rejected: ${err instanceof Error ? err.message : 'URL must not resolve to a private or reserved IP address'}`,
          });
        }
      }

      const before = await db.select().from(partners).where(eq(partners.id, input.id)).limit(1);

      const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (input.data.name !== undefined) updateData.name = input.data.name;
      if (input.data.industry !== undefined) updateData.industry = input.data.industry;
      if (input.data.departments !== undefined) updateData.departments = input.data.departments;
      if (input.data.aiEnabled !== undefined) updateData.aiEnabled = input.data.aiEnabled;
      if (input.data.aiFeatures !== undefined) updateData.aiFeatures = input.data.aiFeatures;
      if (input.data.aiConfig !== undefined) {
        const configToStore = { ...input.data.aiConfig } as Record<string, unknown>;
        if (configToStore.apiKey && typeof configToStore.apiKey === 'string') {
          try {
            configToStore.encryptedApiKey = encrypt(configToStore.apiKey);
            delete configToStore.apiKey;
          } catch {
            if (config.NODE_ENV === 'production') {
              throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Cannot store API key: AI_KEY_ENCRYPTION_SECRET is not configured' });
            }
            logger.warn('[platform] AI_KEY_ENCRYPTION_SECRET not set — API key stored unencrypted');
          }
        }
        updateData.aiConfig = configToStore;
      }
      if (input.data.aiProvider !== undefined) updateData.aiProvider = input.data.aiProvider;
      if (input.data.aiModel !== undefined) updateData.aiModel = input.data.aiModel;

      await db.update(partners)
        .set(updateData)
        .where(eq(partners.id, input.id));

      if (before[0]) {
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        const auditData = { ...input.data } as Record<string, unknown>;
        if (input.data.aiConfig?.apiKey) {
          auditData.aiConfig = {
            ...input.data.aiConfig,
            apiKey: `****${input.data.aiConfig.apiKey.slice(-4)}`,
          };
        }
        const beforeData = before[0] as Record<string, unknown>;
        Object.keys(auditData).forEach(key => {
          if (auditData[key] !== beforeData[key]) {
            diff[key] = { from: beforeData[key], to: auditData[key] };
          }
        });

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'partner.config_updated',
          actorId: ctx.user.id,
          partnerId: input.id,
          targetType: 'partner',
          targetId: input.id,
          metadata: { changes: diff }
        });
      }
      return { success: true };
    }),

  deactivatePartner: platformProcedure
    .input(z.object({ partnerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Destructive action — partner status + bulk ticket close + audit
        // must commit atomically. See patterns/audit-insert-atomicity.
        // broadcastPartnerDeactivation runs AFTER commit; a rollback
        // otherwise would broadcast a state change that never persisted.
        await db.transaction(async (tx) => {
          await tx.update(partners).set({ status: 'inactive' }).where(eq(partners.id, input.partnerId));

          const now = new Date().toISOString();
          await tx.update(tickets)
            .set({ status: 'closed', closedAt: now, closedBy: 'System', closingNotes: 'Partner deactivated' })
            .where(and(
              eq(tickets.partnerId, input.partnerId),
              inArray(tickets.status, ['open', 'pending'])
            ));

          await tx.insert(auditLog).values({
            action: 'partner.deactivated',
            actorId: ctx.user.id,
            partnerId: input.partnerId,
            targetType: 'partner',
            targetId: input.partnerId,
          });
        });

        broadcastPartnerDeactivation(input.partnerId);

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'deactivate partner');
      }
    }),

  reactivatePartner: platformProcedure
    .input(z.object({ partnerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        // Destructive-inverse action; audit must commit with the status flip.
        await db.transaction(async (tx) => {
          await tx.update(partners).set({ status: 'active' }).where(eq(partners.id, input.partnerId));

          await tx.insert(auditLog).values({
            action: 'partner.reactivated',
            actorId: ctx.user.id,
            partnerId: input.partnerId,
            targetType: 'partner',
            targetId: input.partnerId,
          });
        });

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'reactivate partner');
      }
    }),

  deletePartner: platformProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      // Destructive action — soft-delete partner + bulk ticket close + audit
      // must commit atomically. Without a transaction, a crash between the
      // ticket close and the audit insert leaves a deleted partner with no
      // audit row describing who deleted it.
      await db.transaction(async (tx) => {
        const now = new Date().toISOString();
        await tx.update(tickets)
          .set({ status: 'closed', closedAt: now, closedBy: 'System', closingNotes: 'Partner deleted' })
          .where(and(
            eq(tickets.partnerId, input),
            inArray(tickets.status, ['open', 'pending'])
          ));

        await tx.update(partners)
          .set({ deletedAt: now })
          .where(eq(partners.id, input));

        await tx.insert(auditLog).values({
          action: 'partner.deleted',
          actorId: ctx.user.id,
          partnerId: input,
          targetType: 'partner',
          targetId: input,
        });
      });

      broadcastPartnerDeactivation(input);

      return { success: true };
    }),
});
