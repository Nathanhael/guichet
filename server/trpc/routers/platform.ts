import { z } from 'zod';
import { router, platformProcedure } from '../trpc.js';
import { db, run } from '../../db.js';
import { partners, memberships, users, auditLog, tickets } from '../../db/schema.js';
import { eq, asc, desc, sql, isNull, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { getRedisClients } from '../../utils/redis.js';
import logger from '../../utils/logger.js';
import { broadcastPartnerDeactivation } from '../../socket/handlers.js';

export const platformRouter = router({
  // --- System Health ---
  getSystemHealth: platformProcedure.query(async () => {
    const health = {
      postgres: false,
      redis: false,
      postgresConnections: 0,
      redisMemoryUsed: '0',
      gdprLastRun: '2026-03-20T02:00:00.000Z', // Stubbed
      gdprSuccess: true,
      gdprRecordsPurged: 0
    };

    try {
      const pgRes = await db.execute(sql`SELECT count(*) FROM pg_stat_activity`);
      health.postgres = true;
      health.postgresConnections = parseInt(String(pgRes.rows[0].count), 10);
    } catch (err) {
      console.error('Health Check: Postgres error', err);
    }

    try {
      const { pubClient } = getRedisClients();
      if (pubClient) {
        await pubClient.ping();
        health.redis = true;
        const memoryInfo = await pubClient.info('memory');
        const match = memoryInfo.match(/used_memory_human:([^\r\n]+)/);
        if (match) {
          health.redisMemoryUsed = match[1];
        }
      }
    } catch (err) {
      console.error('Health Check: Redis error', err);
    }

    return health;
  }),

  // --- Partner Management ---
  listPartners: platformProcedure.query(async () => {
    try {
      return await db.select().from(partners)
        .where(isNull(partners.deletedAt))
        .orderBy(asc(partners.name));
    } catch (err: unknown) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  createPartner: platformProcedure
    .input(z.object({
      id: z.string().min(3).max(50),
      name: z.string().min(2),
      logoUrl: z.string().optional().nullable(),
      industry: z.string().default('Telecommunications'),
      departments: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional()
      })).default([]),
      aiProvider: z.string().default('ollama'),
      ollamaModel: z.string().optional().nullable(),
      aiEnabled: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      try {
        await db.insert(partners).values({
          id: input.id,
          name: input.name,
          logoUrl: input.logoUrl,
          industry: input.industry,
          departments: input.departments,
          aiProvider: input.aiProvider,
          ollamaModel: input.ollamaModel,
          aiEnabled: input.aiEnabled,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return { success: true, id: input.id };
      } catch (err: any) {
        if (err.code === '23505') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Partner ID already exists' });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updatePartner: platformProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        name: z.string().optional(),
        logoUrl: z.string().optional().nullable(),
        industry: z.string().optional(),
        departments: z.any().optional(),
        aiProvider: z.string().optional(),
        ollamaModel: z.string().optional().nullable(),
        aiEnabled: z.boolean().optional(),
      })
    }))
    .mutation(async ({ input }) => {
      await db.update(partners)
        .set({ ...input.data, updatedAt: new Date().toISOString() })
        .where(eq(partners.id, input.id));
      return { success: true };
    }),

  deactivatePartner: platformProcedure
    .input(z.object({ partnerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await db.update(partners).set({ status: 'inactive' }).where(eq(partners.id, input.partnerId));
        
        // Auto-close open tickets
        const now = new Date().toISOString();
        await db.update(tickets)
          .set({ status: 'closed', closedAt: now, closedBy: 'System', closingNotes: 'Partner deactivated' })
          .where(and(eq(tickets.partnerId, input.partnerId), eq(tickets.status, 'open')));
        
        // Broadcast to clients
        broadcastPartnerDeactivation(input.partnerId);

        // Audit log
        await db.insert(auditLog).values({
          action: 'partner.deactivated',
          actorId: ctx.user.id,
          partnerId: input.partnerId,
          targetType: 'partner',
          targetId: input.partnerId,
        });

        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  reactivatePartner: platformProcedure
    .input(z.object({ partnerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await db.update(partners).set({ status: 'active' }).where(eq(partners.id, input.partnerId));

        // Audit log
        await db.insert(auditLog).values({
          action: 'partner.reactivated',
          actorId: ctx.user.id,
          partnerId: input.partnerId,
          targetType: 'partner',
          targetId: input.partnerId,
        });

        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  deletePartner: platformProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      await db.update(partners)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(partners.id, input));
      
      await db.insert(auditLog).values({
        action: 'partner.deleted',
        actorId: ctx.user.id,
        partnerId: input,
        targetType: 'partner',
        targetId: input,
      });

      return { success: true };
    }),

  // --- Global User & Membership Management ---
  listGlobalUsers: platformProcedure.query(async () => {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }),

  inviteUser: platformProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['agent', 'support', 'manager', 'admin', 'platform_operator']),
      partnerId: z.string(),
      dept: z.string().optional(), // legacy
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input }) => {
      try {
        // 1. Ensure user exists or create them (Invite mode)
        let userId: string;
        const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        
        if (existing.length > 0) {
          userId = existing[0].id;
        } else {
          userId = `u_${randomUUID().slice(0, 8)}`;
          await db.insert(users).values({
            id: userId,
            email: input.email,
            name: input.name,
            isPlatformOperator: input.role === 'platform_operator',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        // 2. Add Membership
        const memId = `mem_${randomUUID().slice(0, 8)}`;
        await db.insert(memberships).values({
          id: memId,
          userId,
          partnerId: input.partnerId,
          role: input.role as any,
          dept: input.dept,
          departments: input.departments || []
        });

        return { userId, membershipId: memId };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  removeMembership: platformProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      await db.delete(memberships).where(eq(memberships.id, input));
      return { success: true };
    }),

  deleteUser: platformProcedure
    .input(z.string())
    .mutation(async ({ input }) => {
      // Soft delete
      await db.update(users)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(users.id, input));
      return { success: true };
    }),

  // --- Audit Log ---
  getAuditLog: platformProcedure
    .input(z.object({
      action: z.string().optional(),
      partnerId: z.string().optional(),
      actorId: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      try {
        let conditions = [];
        if (input.action) conditions.push(eq(auditLog.action, input.action));
        if (input.partnerId) conditions.push(eq(auditLog.partnerId, input.partnerId));
        if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit)
        .offset(input.offset);

        return results;
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});