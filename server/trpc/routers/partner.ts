import { z } from 'zod';
import { router, adminProcedure, protectedProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { partners, users, memberships, auditLog } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import { getBusinessHoursStatus, type BusinessHoursSchedule } from '../../services/businessHours.js';
import { hashPassword } from '../../utils/passwords.js';
import { canAssignTenantRole } from '../../services/roles.js';

// simple slugify helper
function makeSlug(text: string) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function scheduleFromLegacyBusinessHours(input: {
  businessHoursStart: string | null;
  businessHoursEnd: string | null;
  businessHoursTimezone: string | null;
}): BusinessHoursSchedule {
  const timezone = input.businessHoursTimezone || 'Europe/Brussels';
  const start = input.businessHoursStart || '07:30';
  const end = input.businessHoursEnd || '22:30';

  return {
    version: 1,
    timezone,
    weekly: {
      mon: { closed: false, windows: [{ start, end }] },
      tue: { closed: false, windows: [{ start, end }] },
      wed: { closed: false, windows: [{ start, end }] },
      thu: { closed: false, windows: [{ start, end }] },
      fri: { closed: false, windows: [{ start, end }] },
      sat: { closed: true, windows: [] },
      sun: { closed: true, windows: [] },
    },
    exceptions: [],
  };
}

const businessHoursWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const businessHoursDayScheduleSchema = z.object({
  closed: z.boolean(),
  windows: z.array(businessHoursWindowSchema),
});

const businessHoursExceptionSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closed: z.boolean().optional(),
  windows: z.array(businessHoursWindowSchema).optional(),
  note: z.string().optional(),
});

const businessHoursScheduleSchema = z.object({
  version: z.literal(1),
  timezone: z.string().min(1),
  weekly: z.object({
    mon: businessHoursDayScheduleSchema,
    tue: businessHoursDayScheduleSchema,
    wed: businessHoursDayScheduleSchema,
    thu: businessHoursDayScheduleSchema,
    fri: businessHoursDayScheduleSchema,
    sat: businessHoursDayScheduleSchema,
    sun: businessHoursDayScheduleSchema,
  }),
  exceptions: z.array(businessHoursExceptionSchema),
});

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function validateWindows(windows: { start: string; end: string }[], ctx: z.RefinementCtx, path: (string | number)[]) {
  const normalized = windows.map((window, index) => {
    const start = toMinutes(window.start);
    const end = toMinutes(window.end);
    if (start === end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Window start and end cannot be the same.',
        path: [...path, index],
      });
    }
    return {
      index,
      start,
      end: end <= start ? end + 1440 : end,
    };
  }).sort((a, b) => a.start - b.start);

  for (let i = 1; i < normalized.length; i++) {
    const prev = normalized[i - 1];
    const current = normalized[i];
    if (current.start < prev.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Windows cannot overlap.',
        path,
      });
      break;
    }
  }
}

export const validatedBusinessHoursScheduleSchema = businessHoursScheduleSchema.superRefine((schedule, ctx) => {
  if (!isValidTimezone(schedule.timezone)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid timezone.',
      path: ['timezone'],
    });
  }

  for (const [dayKey, daySchedule] of Object.entries(schedule.weekly)) {
    if (daySchedule.closed && daySchedule.windows.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Closed days cannot contain windows.',
        path: ['weekly', dayKey, 'windows'],
      });
    }

    if (!daySchedule.closed && daySchedule.windows.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Open days must contain at least one window.',
        path: ['weekly', dayKey, 'windows'],
      });
    }

    if (daySchedule.windows.length > 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A day can have at most 4 windows.',
        path: ['weekly', dayKey, 'windows'],
      });
    }

    validateWindows(daySchedule.windows, ctx, ['weekly', dayKey, 'windows']);
  }

  const seenDates = new Set<string>();
  schedule.exceptions.forEach((exception, index) => {
    if (seenDates.has(exception.date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exception dates must be unique.',
        path: ['exceptions', index, 'date'],
      });
    }
    seenDates.add(exception.date);

    if (exception.closed && exception.windows && exception.windows.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Closed exceptions cannot include windows.',
        path: ['exceptions', index, 'windows'],
      });
    }

    if (!exception.closed && (!exception.windows || exception.windows.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Open exceptions must include at least one window.',
        path: ['exceptions', index, 'windows'],
      });
    }

    if ((exception.windows?.length ?? 0) > 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An exception can have at most 4 windows.',
        path: ['exceptions', index, 'windows'],
      });
    }

    validateWindows(exception.windows ?? [], ctx, ['exceptions', index, 'windows']);
  });
});

export const partnerRouter = router({
  getManifest: adminProcedure.query(async ({ ctx }) => {
    try {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

      const result = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

      return result[0];
    } catch (err: unknown) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  getBusinessHours: protectedProcedure.query(async ({ ctx }) => {
    try {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

      const result = await db.select({
        businessHoursSchedule: partners.businessHoursSchedule,
        businessHoursStart: partners.businessHoursStart,
        businessHoursEnd: partners.businessHoursEnd,
        businessHoursTimezone: partners.businessHoursTimezone,
      }).from(partners).where(eq(partners.id, partnerId)).limit(1);

      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

      const row = result[0];
      const schedule = (row.businessHoursSchedule as BusinessHoursSchedule | null) ?? null;
      const status = getBusinessHoursStatus({
        businessHoursSchedule: schedule,
        businessHoursStart: row.businessHoursStart,
        businessHoursEnd: row.businessHoursEnd,
        businessHoursTimezone: row.businessHoursTimezone,
      });

      return {
        schedule,
        status,
      };
    } catch (err: unknown) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
    }
  }),

  updateBusinessHours: adminProcedure
    .input(z.object({
      schedule: validatedBusinessHoursScheduleSchema.optional(),
      businessHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      businessHoursTimezone: z.string().min(1).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const schedule = input.schedule ?? scheduleFromLegacyBusinessHours({
          businessHoursStart: input.businessHoursStart ?? null,
          businessHoursEnd: input.businessHoursEnd ?? null,
          businessHoursTimezone: input.businessHoursTimezone ?? null,
        });

        const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
        const primaryWindow = weekdays
          .map((day) => schedule.weekly[day].windows[0])
          .find(Boolean);

        await db.update(partners)
          .set({ 
            businessHoursSchedule: schedule,
            businessHoursStart: primaryWindow?.start ?? null,
            businessHoursEnd: primaryWindow?.end ?? null,
            businessHoursTimezone: schedule.timezone,
          })
          .where(eq(partners.id, partnerId));

        await db.insert(auditLog).values({
          action: 'partner.config_updated',
          actorId: ctx.user.id,
          partnerId,
          targetType: 'partner',
          targetId: partnerId,
          metadata: { details: 'Business hours updated', timezone: schedule.timezone },
        });

        logger.info({ partnerId }, 'Business Hours updated by Partner Admin');
        return {
          success: true,
          schedule,
          status: getBusinessHoursStatus({ businessHoursSchedule: schedule }),
        };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateDepartments: adminProcedure
    .input(z.object({
      departments: z.array(z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        referenceFields: z.array(z.object({
          label: z.string().min(1),
        })).max(3).optional().refine(
          (fields) => {
            if (!fields) return true;
            const labels = fields.map(f => f.label);
            return new Set(labels).size === labels.length;
          },
          { message: 'Reference field labels must be unique within a department' }
        ),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const mappedDepartments = input.departments.map(d => ({
          id: d.id ? d.id : makeSlug(d.name),
          name: d.name,
          description: d.description || '',
          referenceFields: d.referenceFields || [],
        }));

        await db.update(partners)
          .set({ departments: mappedDepartments })
          .where(eq(partners.id, partnerId));

        await db.insert(auditLog).values({
          action: 'partner.config_updated',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'partner',
          targetId: partnerId,
          metadata: { details: 'Departments updated' }
        });

        logger.info({ partnerId, count: mappedDepartments.length }, 'Departments updated by Partner Admin');
        return { success: true, departments: mappedDepartments };
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  listMembers: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const result = await db
          .select({
            membershipId: memberships.id,
            userId: users.id,
            name: users.name,
            email: users.email,
            role: memberships.role,
            departments: memberships.departments,
            createdAt: memberships.createdAt,
            externalId: users.externalId,
            lastActiveAt: users.lastActiveAt,
          })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .where(eq(memberships.partnerId, partnerId))
          .limit(input.limit)
          .offset(input.offset);

        return result;
      } catch (err: unknown) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  addMemberByEmail: adminProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(['agent', 'support']),
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
        if (!canAssignTenantRole(ctx.user.role, ctx.user.isPlatformOperator, input.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Tenant admins can only assign agent or support roles' });
        }

        const targetUser = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        if (targetUser.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
        }
        
        const userId = targetUser[0].id;

        const existingMembership = await db.select().from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, partnerId))).limit(1);
        
        if (existingMembership.length > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: 'User already on this partner' });
        }

        const newMembershipId = uuidv4();

        await db.insert(memberships).values({
          id: newMembershipId,
          userId: userId,
          partnerId: partnerId,
          role: input.role,
          departments: input.departments || []
        });

        await db.insert(auditLog).values({
          action: 'member.added',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: userId,
          metadata: { role: input.role, departments: input.departments }
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  inviteExternalUser: adminProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(['agent', 'support']),
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
        if (!canAssignTenantRole(ctx.user.role, ctx.user.isPlatformOperator, input.role)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Tenant admins can only assign agent or support roles' });
        }

        // 1. Look up partner auth method
        const partner = await db.select({ authMethod: partners.authMethod })
          .from(partners)
          .where(eq(partners.id, partnerId))
          .limit(1);

        if (partner.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
        }

        const isLocal = partner[0].authMethod === 'local';

        // 2. Check for existing user
        const existingUser = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
        if (existingUser.length > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Email already in use' });
        }

        // 3. Create user — with or without password based on auth method
        let tempPassword: string | null = null;
        const newUserId = uuidv4();

        let hashedPassword: string | undefined;
        if (isLocal) {
          tempPassword = randomBytes(12).toString('base64url');
          hashedPassword = await hashPassword(tempPassword);
        }

        await db.insert(users).values({
          id: newUserId,
          email: input.email,
          name: input.name,
          password: hashedPassword,
        });

        // 4. Create membership
        const newMembershipId = uuidv4();
        await db.insert(memberships).values({
          id: newMembershipId,
          userId: newUserId,
          partnerId: partnerId,
          role: input.role,
          departments: input.departments || []
        });

        // 5. Audit log
        await db.insert(auditLog).values({
          action: 'member.invited',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: newUserId,
          metadata: { role: input.role, departments: input.departments, email: input.email, authMethod: partner[0].authMethod }
        });

        // Never log plaintext passwords
        logger.info({ userId: newUserId, authMethod: partner[0].authMethod }, '[inviteExternalUser] User created');
        return { success: true, userId: newUserId, tempPassword: tempPassword ?? '' };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  updateMember: adminProcedure
    .input(z.object({
      membershipId: z.string(),
      departments: z.array(z.string()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const membership = await db.select().from(memberships)
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.partnerId, partnerId))).limit(1);

        if (membership.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
        }

        await db.update(memberships)
          .set({ departments: input.departments || [] })
          .where(eq(memberships.id, input.membershipId));

        await db.insert(auditLog).values({
          action: 'member.updated',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: membership[0].userId,
          metadata: { departments: input.departments }
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),

  removeMember: adminProcedure
    .input(z.object({
      membershipId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const membership = await db.select().from(memberships)
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.partnerId, partnerId))).limit(1);

        if (membership.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
        }

        if (membership[0].userId === ctx.user.id) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove yourself' });
        }

        const userMemberships = await db.select().from(memberships)
          .where(eq(memberships.userId, membership[0].userId));

        if (userMemberships.length <= 1) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove user\'s last membership. Platform Operator must handle this.' });
        }

        await db.delete(memberships).where(eq(memberships.id, input.membershipId));

        await db.insert(auditLog).values({
          action: 'member.removed',
          actorId: ctx.user.id,
          partnerId: partnerId,
          targetType: 'user',
          targetId: membership[0].userId,
          metadata: {}
        });

        return { success: true };
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
      }
    }),
});
