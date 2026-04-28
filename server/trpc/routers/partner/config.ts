import { z } from 'zod';
import { router, adminProcedure, partnerAdminProcedure, protectedProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, memberships, auditLog } from '../../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../../utils/logger.js';
import { wrapError } from '../../../utils/trpcErrors.js';
import { getBusinessHoursStatus, type BusinessHoursSchedule } from '../../../services/businessHours.js';
import { getPartnerAiConfig } from '../../../services/ai/index.js';
import config from '../../../config.js';
import { trpcActor } from '../../../services/auth/index.js';

// simple slugify helper
function makeSlug(text: string) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
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

export const partnerConfigRouter = router({
  getManifest: adminProcedure.query(async ({ ctx }) => {
    try {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

      const result = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

      // Strip sensitive AI configuration (API keys, provider config) from the response
      const { aiConfig: _aiConfig, aiProvider: _aiProvider, aiModel: _aiModel, ...safePartner } = result[0];
      return safePartner;
    } catch (err: unknown) {
      // IM-11: Re-throw TRPCErrors (e.g. NOT_FOUND) instead of swallowing into INTERNAL_SERVER_ERROR
      if (err instanceof TRPCError) throw err;
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'tRPC: getManifest error');
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch partner manifest' });
    }
  }),

  getAiConfig: protectedProcedure.query(async ({ ctx }) => {
    const partnerId = ctx.user.partnerId;
    if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

    const aiConfig = await getPartnerAiConfig(partnerId);

    return {
      globalAiEnabled: config.AI_ENABLED,
      ...aiConfig,
    };
  }),

  getBusinessHours: protectedProcedure.query(async ({ ctx }) => {
    try {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

      const result = await db.select({
        businessHoursSchedule: partners.businessHoursSchedule,
      }).from(partners).where(eq(partners.id, partnerId)).limit(1);

      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

      const schedule = (result[0].businessHoursSchedule as BusinessHoursSchedule | null) ?? null;
      const status = getBusinessHoursStatus({ businessHoursSchedule: schedule });

      return {
        schedule,
        status,
      };
    } catch (err: unknown) {
      wrapError(err, 'get business hours');
    }
  }),

  updateBusinessHours: adminProcedure
    .input(z.object({
      schedule: validatedBusinessHoursScheduleSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const schedule = input.schedule;

        await db.update(partners)
          .set({ businessHoursSchedule: schedule })
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
        wrapError(err, 'update business hours');
      }
    }),

  updateDepartments: partnerAdminProcedure
    .input(z.object({
      departments: z.array(z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        referenceFields: z.array(z.object({
          label: z.string().min(1),
          optional: z.boolean().optional(),
        })).max(5).optional().refine(
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
        const actor = trpcActor(ctx, { capability: 'destructive_admin' });

        const mappedDepartments = input.departments.map(d => ({
          id: d.id ? d.id : makeSlug(d.name),
          name: d.name,
          description: d.description || '',
          referenceFields: d.referenceFields || [],
        }));

        await db.update(partners)
          .set({ departments: mappedDepartments })
          .where(eq(partners.id, actor.partnerId));

        // Auto-sync: admin members always get all department IDs
        const allDeptIds = mappedDepartments.map(d => d.id);
        await db.update(memberships)
          .set({ departments: allDeptIds })
          .where(and(eq(memberships.partnerId, actor.partnerId), eq(memberships.role, 'admin')));

        await db.insert(auditLog).values({
          action: 'partner.config_updated',
          actorId: actor.userId,
          partnerId: actor.partnerId,
          targetType: 'partner',
          targetId: actor.partnerId,
          metadata: { details: 'Departments updated' }
        });

        logger.info({ partnerId: actor.partnerId, count: mappedDepartments.length }, 'Departments updated by Partner Admin');
        return { success: true, departments: mappedDepartments };
      } catch (err: unknown) {
        wrapError(err, 'update departments');
      }
    }),

  updateDepartmentSla: partnerAdminProcedure
    .input(z.object({
      departmentId: z.string().min(1),
      sla: z.object({
        enabled: z.boolean(),
        firstResponseMinutes: z.number().int().min(1).max(480),
        warnAtPercent: z.number().int().refine((v) => v === 50 || v === 75 || v === 90, { message: 'warnAtPercent must be 50, 75, or 90' }),
      }).nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = trpcActor(ctx, { capability: 'destructive_admin' });

      return db.transaction(async (tx) => {
        const [row] = await tx.select({ departments: partners.departments }).from(partners).where(eq(partners.id, actor.partnerId));
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

        const departments = (row.departments ?? []) as Array<{ id: string; name: string; description?: string; referenceFields?: unknown[]; sla?: unknown }>;
        const idx = departments.findIndex((d) => d.id === input.departmentId);
        if (idx === -1) throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });

        const nextDept = { ...departments[idx] };
        if (input.sla === null) {
          delete nextDept.sla;
        } else {
          nextDept.sla = input.sla;
        }
        const nextDepartments = [...departments];
        nextDepartments[idx] = nextDept;

        await tx.update(partners).set({ departments: nextDepartments }).where(eq(partners.id, actor.partnerId));

        await tx.insert(auditLog).values({
          action: 'partner.department.sla_updated',
          actorId: actor.userId,
          partnerId: actor.partnerId,
          targetType: 'department',
          targetId: input.departmentId,
          metadata: { sla: input.sla },
        });

        return { success: true };
      });
    }),
});
