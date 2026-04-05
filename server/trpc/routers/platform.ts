import { z } from 'zod';
import { router, platformProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, memberships, users, auditLog, tickets, systemSettings, partnerGroupMappings, auditArchive, archivedTickets } from '../../db/schema.js';
import { eq, asc, desc, sql, isNull, and, gte, lte, inArray, ilike } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { randomUUID, randomBytes } from 'crypto';
import { getRedisClients } from '../../utils/redis.js';
import logger from '../../utils/logger.js';
import { broadcastPartnerDeactivation } from '../../socket/handlers.js';
import { MailService } from '../../services/mail.js';
import { renderInviteNew, renderInviteExisting, renderInviteReminder, renderTestEmail } from '../../services/mailTemplates.js';
import { hashPassword } from '../../utils/passwords.js';
import { validateWebhookUrl } from '../../services/webhookDispatch.js';
import { encrypt } from '../../services/encryption.js';
import config from '../../config.js';

export const platformRouter = router({
  // --- System Health ---
  getSystemHealth: platformProcedure.query(async () => {
    let lastPurgeAt: string | null = null;
    let gdprSuccess = false;

    try {
      const lastPurge = await db.select({ createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(eq(auditLog.action, 'system.gdpr_purge'))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      lastPurgeAt = lastPurge[0]?.createdAt || null;
      gdprSuccess = !!lastPurge[0];
    } catch (err) {
      logger.error({ err }, 'Health Check: Audit Log error');
    }

    const health = {
      postgres: false,
      redis: false,
      postgresConnections: 0,
      redisMemoryUsed: '0',
      gdprLastRun: lastPurgeAt || 'Never',
      gdprSuccess,
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
        // Add timeout to prevent hanging on unreachable Redis
        await Promise.race([
          pubClient.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 2000))
        ]);
        
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
      // IM-10: Fetch all then strip sensitive AI config (API keys, provider details)
      const allPartners = await db.select().from(partners)
        .where(isNull(partners.deletedAt))
        .orderBy(asc(partners.name));
      return allPartners.map(({ aiConfig, aiProvider, aiModel, ...safe }) => safe);
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tRPC: listPartners error');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list partners' });
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
      authMethod: z.enum(['local', 'sso', 'both']).default('local'),
    }))
    .mutation(async ({ input, ctx }) => {
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

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'partner.created',
          actorId: ctx.user.id,
          partnerId: input.id,
          targetType: 'partner',
          targetId: input.id,
          metadata: {
            authMethod: input.authMethod,
            industry: input.industry,
          },
        });

        return { success: true, id: input.id };
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
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
        authMethod: z.enum(['local', 'sso', 'both']).optional(),
        // AI configuration
        aiEnabled: z.boolean().optional(),
        aiFeatures: z.object({
          messageImprovement: z.enum(['off', 'optional', 'forced']).optional(),
          chatSummarization: z.boolean().optional(),
          translation: z.boolean().optional(),
          sentimentDetection: z.boolean().optional(),
          autoSummarizeOnClose: z.boolean().optional(),
        }).optional(),
        // AI provider configuration (baseUrl, apiKey, deployment)
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
      // H-4: SSRF validation — reject aiConfig.baseUrl pointing to private/reserved IPs
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

      // Explicitly pick only allowed fields — never spread unsanitized input
      const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (input.data.name !== undefined) updateData.name = input.data.name;
      if (input.data.logoUrl !== undefined) updateData.logoUrl = input.data.logoUrl;
      if (input.data.industry !== undefined) updateData.industry = input.data.industry;
      if (input.data.departments !== undefined) updateData.departments = input.data.departments;
      if (input.data.authMethod !== undefined) updateData.authMethod = input.data.authMethod;
      if (input.data.aiEnabled !== undefined) updateData.aiEnabled = input.data.aiEnabled;
      if (input.data.aiFeatures !== undefined) updateData.aiFeatures = input.data.aiFeatures;
      if (input.data.aiConfig !== undefined) {
        const configToStore = { ...input.data.aiConfig } as Record<string, unknown>;
        // Encrypt the API key before storing (SEC-5)
        if (configToStore.apiKey && typeof configToStore.apiKey === 'string') {
          try {
            configToStore.encryptedApiKey = encrypt(configToStore.apiKey);
            delete configToStore.apiKey; // Never store plaintext
          } catch (err) {
            if (config.NODE_ENV === 'production') {
              throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Cannot store API key: AI_KEY_ENCRYPTION_SECRET is not configured' });
            }
            // Dev only: store as-is with warning
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
        // Redact API key from audit metadata
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

      // Explicit field picking — never spread unsanitized input into .set()
      const allowedFields: Partial<typeof users.$inferInsert> = {};
      if (input.data.name !== undefined) allowedFields.name = input.data.name;
      if (input.data.email !== undefined) allowedFields.email = input.data.email;
      allowedFields.updatedAt = new Date().toISOString();

      await db.update(users)
        .set(allowedFields)
        .where(eq(users.id, input.id));

      if (before[0]) {
        const diff: Record<string, { from: string | null; to: string }> = {};
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

        // Auto-close open and pending tickets
        const now = new Date().toISOString();
        await db.update(tickets)
          .set({ status: 'closed', closedAt: now, closedBy: 'System', closingNotes: 'Partner deactivated' })
          .where(and(
            eq(tickets.partnerId, input.partnerId),
            inArray(tickets.status, ['open', 'pending'])
          ));
        
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
      // Close open and active tickets before soft-deleting
      const now = new Date().toISOString();
      await db.update(tickets)
        .set({ status: 'closed', closedAt: now, closedBy: 'System', closingNotes: 'Partner deleted' })
        .where(and(
          eq(tickets.partnerId, input),
          inArray(tickets.status, ['open', 'pending'])
        ));

      await db.update(partners)
        .set({ deletedAt: now })
        .where(eq(partners.id, input));

      // Broadcast deactivation to connected clients
      broadcastPartnerDeactivation(input);

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
  listGlobalUsers: platformProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(200).default(100),
    }).optional())
    .query(async ({ input }) => {
    const limit = input?.limit ?? 100;
    const cursor = input?.cursor;

    // Select only non-sensitive columns — exclude password, mfaSecret, passwordHistory, etc.
    const userColumns = {
      id: users.id,
      email: users.email,
      externalId: users.externalId,
      name: users.name,
      lang: users.lang,
      avatarUrl: users.avatarUrl,
      isPlatformOperator: users.isPlatformOperator,
      authMethod: users.authMethod,
      lastActiveAt: users.lastActiveAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
      failedLoginAttempts: users.failedLoginAttempts,
      lockedUntil: users.lockedUntil,
      mfaEnabledAt: users.mfaEnabledAt,
      platformTotpEnabledAt: users.platformTotpEnabledAt,
      notificationPreferences: users.notificationPreferences,
      accessibilityPrefs: users.accessibilityPrefs,
    };

    let query = db.select(userColumns).from(users).orderBy(desc(users.createdAt), desc(users.id));

    if (cursor) {
      const sepIdx = cursor.indexOf('|');
      if (sepIdx > 0) {
        const cursorTime = cursor.slice(0, sepIdx);
        const cursorId = cursor.slice(sepIdx + 1);
        query = query.where(
          sql`(${users.createdAt} < ${cursorTime} OR (${users.createdAt} = ${cursorTime} AND ${users.id} < ${cursorId}))`
        ) as typeof query;
      }
    }

    const allUsers = await query.limit(limit + 1);
    const hasMore = allUsers.length > limit;
    const pageUsers = hasMore ? allUsers.slice(0, limit) : allUsers;

    // Fetch memberships for the page of users
    const userIds = pageUsers.map(u => u.id);
    const allMemberships = userIds.length > 0
      ? await db
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
          .where(and(isNull(partners.deletedAt), inArray(memberships.userId, userIds)))
      : [];

    const lastItem = pageUsers[pageUsers.length - 1];
    const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

    return {
      users: pageUsers.map(u => ({
        ...u,
        partnerMemberships: allMemberships.filter(m => m.userId === u.id),
      })),
      nextCursor,
    };
  }),

  inviteUser: platformProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['agent', 'support', 'admin', 'platform_operator']),
      partnerId: z.string(),
      departments: z.array(z.string()).optional(),
      authMethod: z.enum(['local', 'sso', 'both']).optional(),
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

        // Determine effective auth method for this user:
        // - If caller specified per-user authMethod, use that
        // - If partner is 'both', default to 'local' unless caller specified 'sso'
        // - Otherwise use partner's authMethod
        const userAuthMethod = input.authMethod ?? (partner[0].authMethod === 'both' ? 'local' : partner[0].authMethod);
        const isLocal = userAuthMethod === 'local';
        let tempPassword: string | null = null;
        let isExistingUser = false;

        // 2. Ensure user exists or create them
        let userId: string;
        const existing = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

        if (existing.length > 0) {
          userId = existing[0].id;
          isExistingUser = true;
          // If partner supports 'both', set per-user auth method
          if (partner[0].authMethod === 'both' && input.authMethod) {
            await db.update(users).set({ authMethod: input.authMethod }).where(eq(users.id, userId));
          }
        } else {
          userId = `u_${randomUUID().slice(0, 8)}`;

          // Generate temp password only for new users with local auth
          let hashedPassword: string | undefined;
          if (isLocal) {
            tempPassword = randomBytes(12).toString('base64url');
            hashedPassword = await hashPassword(tempPassword);
          }

          await db.insert(users).values({
            id: userId,
            email: input.email,
            name: input.name,
            password: hashedPassword,
            isPlatformOperator: input.role === 'platform_operator',
            authMethod: partner[0].authMethod === 'both' ? userAuthMethod : undefined,
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
          role: input.role,
          departments: input.departments || []
        });

        // 5. Send Welcome Email if configured
        try {
          const partnerName = (await db.select({ name: partners.name }).from(partners).where(eq(partners.id, input.partnerId)).limit(1))[0]?.name || input.partnerId;
          const loginUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
          const brand = { partnerName };

          const welcomeHtml = isExistingUser
            ? renderInviteExisting({ name: input.name, partnerName, loginUrl, brand })
            : renderInviteNew({ name: input.name, partnerName, tempPassword: tempPassword ?? undefined, isLocal, loginUrl, brand });

          await MailService.sendMail(input.email, `Invitation to join ${partnerName} on Tessera`, welcomeHtml);
        } catch (mailErr) {
          logger.error({ err: mailErr }, '[inviteUser] Failed to send welcome email');
        }

        // 6. Audit Log
        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'member.invited',
          actorId: ctx.user.id,
          partnerId: input.partnerId,
          targetType: 'user',
          targetId: userId,
          metadata: { email: input.email, role: input.role, membershipId: memId, authMethod: userAuthMethod }
        });

        return { userId, membershipId: memId, tempPassword: tempPassword ?? '', isExistingUser: isExistingUser ?? false };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  resendInvite: platformProcedure
    .input(z.object({
      userId: z.string(),
      partnerId: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        // IM-08: Only select columns needed for invite — never fetch password/secrets into memory
        const user = (await db.select({
          id: users.id,
          name: users.name,
          email: users.email,
          externalId: users.externalId,
        }).from(users).where(eq(users.id, input.userId)).limit(1))[0];
        const partner = (await db.select({
          id: partners.id,
          name: partners.name,
          authMethod: partners.authMethod,
        }).from(partners).where(eq(partners.id, input.partnerId)).limit(1))[0];

        if (!user || !partner) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User or Partner not found' });
        }

        const isLocal = partner.authMethod === 'local';
        let tempPassword: string | null = null;

        if (isLocal && !user.externalId) {
          // Regenerate temp password for local users who haven't linked yet
          tempPassword = randomBytes(12).toString('base64url');
          const hashedPassword = await hashPassword(tempPassword);
          await db.update(users).set({ password: hashedPassword }).where(eq(users.id, user.id));
        }

        const loginUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
        const welcomeHtml = renderInviteReminder({
          name: user.name,
          partnerName: partner.name,
          tempPassword: tempPassword ?? undefined,
          loginUrl,
          brand: { partnerName: partner.name },
        });

        await MailService.sendMail(user.email!, `Reminder: Invitation to join ${partner.name}`, welcomeHtml);

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'member.invite_resent',
          actorId: ctx.user.id,
          partnerId: input.partnerId,
          targetType: 'user',
          targetId: user.id,
          metadata: { email: user.email }
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tRPC: resendInvite error');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to resend invite' });
      }
    }),

  sendTestEmail: platformProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input, ctx }) => {
      const html = renderTestEmail({ operatorId: ctx.user.id, timestamp: new Date().toLocaleString() });
      const success = await MailService.sendMail(input.email, 'Tessera - Mail Configuration Test', html);
      if (!success) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send test email. Check server logs.' });
      }
      return { success: true };
    }),

  // ─── Archive Endpoints ────────────────────────────────────────────────────

  getArchivedAuditLog: platformProcedure
    .input(z.object({
      action: z.string().optional(),
      partnerId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.action) conditions.push(ilike(auditArchive.action, `%${input.action}%`));
      if (input.partnerId) conditions.push(eq(auditArchive.partnerId, input.partnerId));
      if (input.dateFrom) conditions.push(gte(auditArchive.createdAt, `${input.dateFrom}T00:00:00`));
      if (input.dateTo) conditions.push(lte(auditArchive.createdAt, `${input.dateTo}T23:59:59.999`));

      if (input.cursor) {
        const sepIdx = input.cursor.indexOf('|');
        if (sepIdx !== -1) {
          const cursorTime = input.cursor.slice(0, sepIdx);
          const cursorId = input.cursor.slice(sepIdx + 1);
          conditions.push(
            sql`(${auditArchive.createdAt} < ${cursorTime} OR (${auditArchive.createdAt} = ${cursorTime} AND ${auditArchive.id} < ${cursorId}))`
          );
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const results = await db.select().from(auditArchive)
        .where(whereClause)
        .orderBy(desc(auditArchive.createdAt), desc(auditArchive.id))
        .limit(input.limit + 1);

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

      return { items, nextCursor };
    }),

  verifyAuditChain: platformProcedure
    .query(async () => {
      const { verifyAuditChain } = await import('../../services/archive.js');
      return verifyAuditChain();
    }),

  runArchive: platformProcedure
    .mutation(async ({ ctx }) => {
      const { archiveAuditLog, archiveTickets } = await import('../../services/archive.js');
      const auditCount = await archiveAuditLog();
      const ticketCount = await archiveTickets();

      await db.insert(auditLog).values({
        action: 'system.archive_run',
        actorId: ctx.user.id,
        targetType: 'system',
        metadata: { auditCount, ticketCount },
      });

      return { auditCount, ticketCount };
    }),

  getArchivedTickets: platformProcedure
    .input(z.object({
      partnerId: z.string().optional(),
      dept: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [];
      if (input.partnerId) conditions.push(eq(archivedTickets.partnerId, input.partnerId));
      if (input.dept) conditions.push(ilike(archivedTickets.dept, `%${input.dept}%`));
      if (input.dateFrom) conditions.push(gte(archivedTickets.createdAt, `${input.dateFrom}T00:00:00`));
      if (input.dateTo) conditions.push(lte(archivedTickets.createdAt, `${input.dateTo}T23:59:59.999`));

      if (input.cursor) {
        const sepIdx = input.cursor.indexOf('|');
        if (sepIdx !== -1) {
          const cursorTime = input.cursor.slice(0, sepIdx);
          const cursorId = input.cursor.slice(sepIdx + 1);
          conditions.push(
            sql`(${archivedTickets.createdAt} < ${cursorTime} OR (${archivedTickets.createdAt} = ${cursorTime} AND ${archivedTickets.id} < ${cursorId}))`
          );
        }
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const results = await db.select({
        id: archivedTickets.id,
        partnerId: archivedTickets.partnerId,
        dept: archivedTickets.dept,
        agentId: archivedTickets.agentId,
        supportId: archivedTickets.supportId,
        status: archivedTickets.status,
        messageCount: archivedTickets.messageCount,
        createdAt: archivedTickets.createdAt,
        closedAt: archivedTickets.closedAt,
        archivedAt: archivedTickets.archivedAt,
        agentName: sql<string>`(SELECT name FROM users WHERE id = ${archivedTickets.agentId})`.as('agent_name'),
        supportName: sql<string>`(SELECT name FROM users WHERE id = ${archivedTickets.supportId})`.as('support_name'),
      }).from(archivedTickets)
        .where(whereClause)
        .orderBy(desc(archivedTickets.createdAt), desc(archivedTickets.id))
        .limit(input.limit + 1);

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;
      const lastItem = items[items.length - 1];
      const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

      return { items, nextCursor };
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
        role: z.enum(['agent', 'support', 'admin', 'platform_operator']),
        departments: z.array(z.string()).optional()
      })
    }))
    .mutation(async ({ input, ctx }) => {
      const memBefore = await db.select().from(memberships).where(eq(memberships.id, input.id)).limit(1);
      
      await db.update(memberships)
        .set({
          role: input.data.role,
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

      // Sync isPlatformOperator flag on the user record
      const mem = await db.select().from(memberships).where(eq(memberships.id, input.id)).limit(1);
      if (mem[0]) {
        if (input.data.role === 'platform_operator') {
          await db.update(users).set({ isPlatformOperator: true }).where(eq(users.id, mem[0].userId));
        } else {
          // Check if the user still has any other platform_operator membership
          const otherPlatformMemberships = await db.select({ id: memberships.id })
            .from(memberships)
            .where(and(
              eq(memberships.userId, mem[0].userId),
              eq(memberships.role, 'platform_operator')
            ))
            .limit(1);
          if (otherPlatformMemberships.length === 0) {
            await db.update(users).set({ isPlatformOperator: false }).where(eq(users.id, mem[0].userId));
          }
        }
      }
      
      return { success: true };
    }),

  // --- MFA Admin Management ---
  disableUserMfa: platformProcedure
    .input(z.string())
    .mutation(async ({ input: targetUserId, ctx }) => {
      const target = await db.select({ id: users.id, name: users.name, email: users.email, mfaEnabledAt: users.mfaEnabledAt })
        .from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!target[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      if (!target[0].mfaEnabledAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'MFA is not enabled for this user' });

      await db.update(users).set({
        mfaSecret: null,
        mfaEnabledAt: null,
        mfaRecoveryCodes: [],
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, targetUserId));

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'security.mfa_disabled_by_admin',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: targetUserId,
        metadata: { targetName: target[0].name },
      });

      if (target[0].email) {
        MailService.sendMfaDisabledByAdmin(target[0].email, target[0].name, targetUserId).catch(() => {});
      }

      return { success: true };
    }),

  unlockUser: platformProcedure
    .input(z.string())
    .mutation(async ({ input: targetUserId, ctx }) => {
      const target = await db.select({ id: users.id, name: users.name, email: users.email, lockedUntil: users.lockedUntil, failedLoginAttempts: users.failedLoginAttempts })
        .from(users).where(eq(users.id, targetUserId)).limit(1);
      if (!target[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      if (!target[0].lockedUntil && (target[0].failedLoginAttempts ?? 0) === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'User is not locked' });
      }

      await db.update(users).set({
        lockedUntil: null,
        failedLoginAttempts: 0,
        updatedAt: new Date().toISOString(),
      }).where(eq(users.id, targetUserId));

      await db.insert(auditLog).values({
        id: randomUUID(),
        action: 'security.user_unlocked_by_admin',
        actorId: ctx.user.id,
        targetType: 'user',
        targetId: targetUserId,
        metadata: { targetName: target[0].name },
      });

      if (target[0].email) {
        MailService.sendAccountUnlocked(target[0].email, target[0].name).catch(() => {});
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
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      cursor: z.string().optional(), // ISO timestamp|uuid of last item
    }))
    .query(async ({ input }) => {
      try {
        const conditions = [];
        if (input.action) conditions.push(eq(auditLog.action, input.action));
        if (input.partnerId) conditions.push(eq(auditLog.partnerId, input.partnerId));
        if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
        if (input.targetId) conditions.push(eq(auditLog.targetId, input.targetId));

        if (input.dateFrom) {
          conditions.push(gte(auditLog.createdAt, `${input.dateFrom}T00:00:00`));
        }
        if (input.dateTo) {
          conditions.push(lte(auditLog.createdAt, `${input.dateTo}T23:59:59.999`));
        }

        // Cursor-based keyset pagination: "createdAt|id"
        if (input.cursor) {
          const sepIdx = input.cursor.indexOf('|');
          if (sepIdx !== -1) {
            const cursorTime = input.cursor.slice(0, sepIdx);
            const cursorId = input.cursor.slice(sepIdx + 1);
            // Rows older than cursor OR same timestamp with lower id (DESC order)
            conditions.push(
              sql`(${auditLog.createdAt} < ${cursorTime} OR (${auditLog.createdAt} = ${cursorTime} AND ${auditLog.id} < ${cursorId}))`
            );
          }
        }

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
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(input.limit + 1); // fetch one extra to determine if there's a next page

        const hasMore = results.length > input.limit;
        const items = hasMore ? results.slice(0, input.limit) : results;
        const lastItem = items[items.length - 1];
        const nextCursor = hasMore && lastItem ? `${lastItem.createdAt}|${lastItem.id}` : '';

        return { items, nextCursor };
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
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        let conditions = [];
        if (input.action) conditions.push(eq(auditLog.action, input.action));
        if (input.partnerId) conditions.push(eq(auditLog.partnerId, input.partnerId));
        if (input.actorId) conditions.push(eq(auditLog.actorId, input.actorId));
        if (input.targetId) conditions.push(eq(auditLog.targetId, input.targetId));
        if (input.dateFrom) {
          conditions.push(gte(auditLog.createdAt, `${input.dateFrom}T00:00:00`));
        }
        if (input.dateTo) {
          conditions.push(lte(auditLog.createdAt, `${input.dateTo}T23:59:59.999`));
        }

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
        .limit(10000); // Safety cap for CSV export
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  // --- System Configuration ---
  getMailConfig: platformProcedure.query(async () => {
    try {
      const config = await db.select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'mail_config'))
        .limit(1);
      
      return (config[0]?.value as Record<string, unknown>) || { provider: 'none' };
    } catch (err: unknown) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  // --- SSO Group Mappings ---
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
      // Validate partner exists and is SSO
      const partner = await db.select({ authMethod: partners.authMethod })
        .from(partners).where(eq(partners.id, input.partnerId)).limit(1);
      if (partner.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
      if (partner[0].authMethod !== 'sso') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Partner must use SSO auth method' });

      // Support role requires at least one department in mapping
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

      // Resolve effective role after update
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

  updateMailConfig: platformProcedure
    .input(z.object({
      provider: z.enum(['none', 'smtp', 'resend', 'sendgrid']),
      apiKey: z.string().optional(),
      smtpHost: z.string().optional(),
      smtpPort: z.number().optional(),
      smtpUser: z.string().optional(),
      smtpPass: z.string().optional(),
      smtpSecure: z.boolean().default(true),
      fromEmail: z.string().email(),
      fromName: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const before = await db.select().from(systemSettings).where(eq(systemSettings.key, 'mail_config')).limit(1);
        
        await db.insert(systemSettings)
          .values({
            key: 'mail_config',
            value: input,
            updatedAt: new Date().toISOString()
          })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: input, updatedAt: new Date().toISOString() }
          });

        await db.insert(auditLog).values({
          id: randomUUID(),
          action: 'system.mail_config_updated',
          actorId: ctx.user.id,
          targetType: 'system',
          targetId: 'mail_config',
          metadata: { 
            provider: input.provider,
            fromEmail: input.fromEmail,
            hasBefore: !!before[0]
          }
        });

        return { success: true };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});
