import { z } from 'zod';
import { router, adminProcedure, partnerAdminProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, users, memberships, auditLog } from '../../../db/schema.js';
import { eq, ne, and, or, ilike, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { wrapError } from '../../../utils/trpcErrors.js';
import { escapeLikePattern } from '../../../utils/security.js';
import { trpcActor } from '../../../services/auth/index.js';

export const partnerMembersRouter = router({
  listMembers: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      search: z.string().optional(),
      role: z.enum(['agent', 'support']).optional(),
      excludeAdmin: z.boolean().optional().default(true),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const partnerId = ctx.user.partnerId;
        if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

        const filters = [eq(memberships.partnerId, partnerId)];
        if (input.role) {
          filters.push(eq(memberships.role, input.role));
        } else if (input.excludeAdmin) {
          filters.push(ne(memberships.role, 'admin'));
        }
        if (input.search?.trim()) {
          const rawSearch = input.search.trim();
          const s = `%${escapeLikePattern(rawSearch)}%`;

          // ME-07 fix: Allow filtering by department name (access grants)
          // Only match department names for non-agent roles — agents show "Selects per ticket"
          // and shouldn't appear when searching department names like "Technical Support"
          const matchesDept = sql`(${memberships.role} != 'agent' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(${partners.departments}) d
            JOIN jsonb_array_elements_text(${memberships.departments}) md(id) ON d->>'id' = md.id
            WHERE d->>'name' ILIKE ${s}
          ))`;

          filters.push(or(
            ilike(users.name, s),
            ilike(users.email, s),
            sql`${memberships.role}::text ILIKE ${s}`,
            sql`CONCAT(${memberships.role}::text, 's') ILIKE ${s}`,
            matchesDept,
            sql`CASE
              WHEN ${memberships.source} = 'manual'
              THEN 'Manual' ILIKE ${s}
              ELSE FALSE
            END`
          )!);
        }

        const result = await db
          .select({
            membershipId: memberships.id,
            userId: users.id,
            name: users.name,
            email: users.email,
            role: memberships.role,
            departments: memberships.departments,
            source: memberships.source,
            createdAt: memberships.createdAt,
            externalId: users.externalId,
            lastActiveAt: users.lastActiveAt,
          })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .innerJoin(partners, eq(memberships.partnerId, partners.id))
          .where(and(...filters))
          .limit(input.limit)
          .offset(input.offset);

        return result;
      } catch (err: unknown) {
        wrapError(err, `listMembers (search="${input.search ?? ''}")`);
      }
    }),

  // Admins are shown as a compact read-only row above the team table because
  // tenant admin seats are provisioned via Azure group mapping — the partner
  // admin UI intentionally can't mutate them. Small result set (typically <5),
  // so no pagination.
  listAdmins: partnerAdminProcedure
    .query(async ({ ctx }) => {
      const actor = trpcActor(ctx);

      const rows = await db
        .select({
          membershipId: memberships.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          lastActiveAt: users.lastActiveAt,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(and(eq(memberships.partnerId, actor.partnerId), eq(memberships.role, 'admin')))
        .orderBy(users.name);

      return rows;
    }),

  memberStats: adminProcedure
    .query(async ({ ctx }) => {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });

      const rows = await db
        .select({
          role: memberships.role,
          count: sql<number>`count(*)::int`,
        })
        .from(memberships)
        .where(and(
          eq(memberships.partnerId, partnerId),
          ne(memberships.role, 'admin'),
        ))
        .groupBy(memberships.role);

      let total = 0, support = 0, agents = 0;
      for (const row of rows) {
        total += row.count;
        if (row.role === 'support') support += row.count;
        if (row.role === 'agent') agents += row.count;
      }
      return { total, support, agents };
    }),

  // Department slicing is partner-internal operational config (Azure carries
  // no dept claim). Restricted to `role === 'support'`: admins get all depts
  // automatically; agents pick per-ticket. SSO re-sync re-seeds depts only on
  // role change ([sso.ts:484-491]), so manual edits survive same-role logins.
  updateMemberDepartments: partnerAdminProcedure
    .input(z.object({
      membershipId: z.string(),
      departments: z.array(z.string()).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const actor = trpcActor(ctx);

        const row = await db
          .select({ id: memberships.id, role: memberships.role, userId: memberships.userId })
          .from(memberships)
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.partnerId, actor.partnerId)))
          .limit(1);

        if (row.length === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
        }

        if (row[0].role !== 'support') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only support members carry department assignments',
          });
        }

        const partner = await db
          .select({ departments: partners.departments })
          .from(partners)
          .where(eq(partners.id, actor.partnerId))
          .limit(1);
        const validIds = new Set(((partner[0]?.departments as Array<{ id: string }>) || []).map(d => d.id));
        const unknown = input.departments.filter(d => !validIds.has(d));
        if (unknown.length > 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown department id: ${unknown[0]}` });
        }

        await db
          .update(memberships)
          .set({ departments: input.departments })
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.partnerId, actor.partnerId)));

        await db.insert(auditLog).values({
          action: 'member.updated',
          actorId: actor.userId,
          partnerId: actor.partnerId,
          targetType: 'user',
          targetId: row[0].userId,
          metadata: { departments: input.departments },
        });

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'updateMemberDepartments');
      }
    }),
});
