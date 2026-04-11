import { z } from 'zod';
import { router, adminProcedure, protectedProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, memberships, auditLog } from '../../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../../utils/logger.js';
import { getBusinessHoursStatus, type BusinessHoursSchedule } from '../../../services/businessHours.js';
import { getPartnerAiConfig } from '../../../services/ai/index.js';
import config from '../../../config.js';

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

export const partnerConfigRouter = router({
  getManifest: adminProcedure.query(async ({ ctx }) => {
    try {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

      const result = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });

      // Strip sensitive AI configuration (API keys, provider config) from the response
      const { aiConfig, aiProvider, aiModel, ...safePartner } = result[0];
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

        // Auto-sync: admin members always get all department IDs
        const allDeptIds = mappedDepartments.map(d => d.id);
        await db.update(memberships)
          .set({ departments: allDeptIds })
          .where(and(eq(memberships.partnerId, partnerId), eq(memberships.role, 'admin')));

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
});
