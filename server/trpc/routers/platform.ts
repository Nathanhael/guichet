import { z } from 'zod';
import { router, platformProcedure } from '../trpc.js';
import { db, run } from '../../db.js';
import { partners, memberships, users, auditLog, tickets } from '../../db/schema.js';
import { eq, asc, desc, sql, isNull, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomUUID, randomBytes } from 'crypto';
import { getRedisClients } from '../../utils/redis.js';
import logger from '../../utils/logger.js';
import { broadcastPartnerDeactivation } from '../../socket/handlers.js';

export const platformRouter = router({
  // --- System Health ---
  getSystemHealth: platformProcedure.query(async () => {
    const lastPurge = await db.select({ createdAt: auditLog.createdAt })
      .from(auditLog)
      .where(eq(auditLog.action, 'system.gdpr_purge'))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    const health = {
      postgres: false,
      redis: false,
      postgresConnections: 0,
      redisMemoryUsed: '0',
      gdprLastRun: lastPurge[0]?.createdAt || 'Never',
      gdprSuccess: !!lastPurge[0],
      gdprRecordsPurged: 0,
      gdprNextPurge: (() => {
        const next = new Date();
        next.setUTCDate(next.getUTCDate() + 1);
        next.setUTCHours(2, 0, 0, 0);
        return next.toISOString();
      })(),
    };

    try {
      const pgRes = await db.execute(sql`SELECT count(*) FROM pg_stat_activity`);
      health.postgres = true;
      health.postgresConnections = parseInt(String(pgRes.rows[0].count), 10);
    } catch (err) {
      logger.error({ err }, 'Health Check: Postgres error');
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
      logger.error({ err }, 'Health Check: Redis error');
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
      authMethod: z.enum(['local', 'sso']).default('local'),
    }))
    .mutation(async ({ input }) => {
      try {
        await db.insert(partners).values({
          id: input.id,
          name: input.name,
          logoUrl: input.logoUrl,
          industry: input.industry,
          departments: input.departments,
          authMethod: input.authMethod,
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
        // Departments are dynamic JSONB: { id: string, name: string, description?: string, isActive: boolean }[]
        departments: z.array(z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().optional(),
          isActive: z.boolean().default(true)
        })).optional(),
        authMethod: z.enum(['local', 'sso']).optional(),
      })
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await db.select().from(partners).where(eq(partners.id, input.id)).limit(1);
      
      await db.update(partners)
        .set({ ...input.data, updatedAt: new Date().toISOString() })
        .where(eq(partners.id, input.id));

      if (before[0]) {
        const diff: any = {};
        Object.keys(input.data).forEach(key => {
          if ((input.data as any)[key] !== (before[0] as any)[key]) {
            diff[key] = { from: (before[0] as any)[key], to: (input.data as any)[key] };
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

  updateUser: platformProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
      })
    }))
    .mutation(async ({ input, ctx }) => {
      const before = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
      
      await db.update(users)
        .set({ ...input.data, updatedAt: new Date().toISOString() })
        .where(eq(users.id, input.id));

      if (before[0]) {
        const diff: any = {};
        if (input.data.name && input.data.name !== before[0].name) diff.name = { from: before[0].name, to: input.data.name };
        if (input.data.email && input.data.email !== before[0].email) diff.email = { from: before[0].email, to: input.data.email };

        if (Object.keys(diff).length > 0) {
          await db.insert(auditLog).values({
            id: randomUUID(),
            action: 'user.profile_updated',
            actorId: ctx.user.id,
            targetType: 'user',
            targetId: input.id,
            metadata: { changes: diff }
          });
        }
      }
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
    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    const allMemberships = await db
      .select({ 
        id: memberships.id,
        userId: memberships.userId, 
        partnerId: memberships.partnerId, 
        partnerName: partners.name,
        role: memberships.role,
        departments: memberships.departments
      })
      .from(memberships)
      .innerJoin(partners, eq(memberships.partnerId, partners.id))
      .where(isNull(partners.deletedAt));
    return allUsers.map(u => ({
      ...u,
      partnerMemberships: allMemberships.filter(m => m.userId === u.id),
    }));
  }),

  inviteUser: platformProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['agent', 'support', 'manager', 'admin', 'platform_operator']),
      partnerId: z.string(),
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        // 1. Look up partner to determine auth method
        const partner = await db.select({ authMethod: partners.authMethod })
          .from(partners)
          .where(eq(partners.id, input.partnerId))
          .limit(1);

        if (partner.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
        }

        const isLocal = partner[0].authMethod === 'local';
        let tempPassword: string | null = null;
        let isExistingUser = false;

        // 2. Ensure user exists or create them
        let userId: string;
        const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

        if (existing.length > 0) {
          userId = existing[0].id;
          isExistingUser = true;
        } else {
          userId = `u_${randomUUID().slice(0, 8)}`;

          // Generate temp password only for new users on local partners
          let hashedPassword: string | undefined;
          if (isLocal) {
            tempPassword = randomBytes(12).toString('base64url');
            const { hash } = await import('bcryptjs');
            hashedPassword = await hash(tempPassword, 10);
          }

          await db.insert(users).values({
            id: userId,
            email: input.email,
            name: input.name,
            password: hashedPassword,
            isPlatformOperator: input.role === 'platform_operator',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        // 3. Prevent duplicate memberships
        const existingMembership = await db.select()
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, input.partnerId)))
          .limit(1);

        if (existingMembership.length > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: 'User already has a membership with this partner' });
        }

        // 4. Add Membership
        const memId = `mem_${randomUUID().slice(0, 8)}`;
        await db.insert(memberships).values({
          id: memId,
          userId,
          partnerId: input.partnerId,
          role: input.role as any,
          departments: input.departments || []
        });

        // 5. Audit Log
        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'member.invited',
          actorId: ctx.user.id,
          partnerId: input.partnerId,
          targetType: 'user',
          targetId: userId,
          metadata: { email: input.email, role: input.role, membershipId: memId, authMethod: partner[0].authMethod }
        });

        return { userId, membershipId: memId, tempPassword: tempPassword ?? '', isExistingUser: isExistingUser ?? false };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  removeMembership: platformProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      try {
        logger.info({ membershipId: input }, '[removeMembership] Attempting to revoke');
        const mem = await db.select().from(memberships).where(eq(memberships.id, input)).limit(1);
        
        if (!mem[0]) {
          logger.warn({ membershipId: input }, '[removeMembership] Membership not found');
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
        }

        await db.delete(memberships).where(eq(memberships.id, input));
        logger.info({ membershipId: input, userId: mem[0].userId, partnerId: mem[0].partnerId }, '[removeMembership] Deleted membership');
        
        try {
          await db.insert(auditLog).values({
            id: randomUUID(),
            action: 'member.removed',
            actorId: ctx.user.id,
            partnerId: mem[0].partnerId,
            targetType: 'user',
            targetId: mem[0].userId,
            metadata: { membershipId: input, role: mem[0].role }
          });
          logger.info({ membershipId: input }, '[removeMembership] Logged to audit_log');
        } catch (auditErr) {
          logger.error({ err: auditErr, membershipId: input }, '[removeMembership] Failed to log to audit_log');
        }

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err: err instanceof Error ? err.message : String(err), membershipId: input }, '[removeMembership] Error');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateMembership: platformProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        role: z.enum(['agent', 'support', 'manager', 'admin', 'platform_operator']),
        departments: z.array(z.string()).optional()
      })
    }))
    .mutation(async ({ input, ctx }) => {
      const memBefore = await db.select().from(memberships).where(eq(memberships.id, input.id)).limit(1);
      
      await db.update(memberships)
        .set({ 
          role: input.data.role as any, 
          departments: input.data.departments || [] 
        })
        .where(eq(memberships.id, input.id));
      
      if (memBefore[0]) {
        try {
          await db.insert(auditLog).values({
            id: randomUUID(),
            action: 'member.updated',
            actorId: ctx.user.id,
            partnerId: memBefore[0].partnerId,
            targetType: 'user',
            targetId: memBefore[0].userId,
            metadata: { 
              membershipId: input.id, 
              oldRole: memBefore[0].role, 
              newRole: input.data.role 
            }
          });
        } catch (auditErr) {
          logger.error({ err: auditErr }, '[updateMembership] Audit log failed');
        }
      }

      // If role is platform_operator, also sync the user record
      if (input.data.role === 'platform_operator') {
        const mem = await db.select().from(memberships).where(eq(memberships.id, input.id)).limit(1);
        if (mem[0]) {
          await db.update(users).set({ isPlatformOperator: true }).where(eq(users.id, mem[0].userId));
        }
      }
      
      return { success: true };
    }),

  deleteUser: platformProcedure
    .input(z.string())
    .mutation(async ({ input, ctx }) => {
      // Soft delete
      await db.update(users)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(users.id, input));

      try {
        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'user.deleted',
          actorId: ctx.user.id,
          targetType: 'user',
          targetId: input,
          metadata: { softDelete: true }
        });
      } catch (auditErr) {
        logger.error({ err: auditErr }, '[deleteUser] Audit log failed');
      }

      return { success: true };
    }),

  // --- Audit Log ---
  getAuditLog: platformProcedure
    .input(z.object({
      action: z.string().optional(),
      partnerId: z.string().optional(),
      actorId: z.string().optional(),
      targetId: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      try {
        let conditions = [];
        if (input.action) conditions.push(eq(auditLog.action, input.action));
        if (input.partnerId) conditions.push(eq(auditLog.partnerId, input.partnerId));
        if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
        if (input.targetId) conditions.push(eq(auditLog.targetId, input.targetId));

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

  exportAuditLog: platformProcedure
    .input(z.object({
      action: z.string().optional(),
      partnerId: z.string().optional(),
      actorId: z.string().optional(),
      targetId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        let conditions = [];
        if (input.action) conditions.push(eq(auditLog.action, input.action));
        if (input.partnerId) conditions.push(eq(auditLog.partnerId, input.partnerId));
        if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
        if (input.targetId) conditions.push(eq(auditLog.targetId, input.targetId));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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
        .where(whereClause)
        .orderBy(desc(auditLog.createdAt))
        .limit(1000); // Reasonable limit for direct export
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});