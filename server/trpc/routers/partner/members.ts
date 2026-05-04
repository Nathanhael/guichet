import { z } from 'zod';
import { router, adminProcedure, partnerAdminProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, users, memberships } from '../../../db/schema.js';
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
      dormant: z.boolean().optional(),
      pendingInvite: z.boolean().optional(),
      excludePending: z.boolean().optional(),
      isExternal: z.boolean().optional(),
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
        if (input.dormant) {
          // B2B guest support seats only. Internal users are governed by Azure
          // account lifecycle (disabled account → SSO fails → no access), so
          // tracking their dormancy here is redundant.
          filters.push(eq(users.isExternal, true));
          filters.push(eq(memberships.role, 'support'));
          filters.push(sql`${users.lastActiveAt} IS NOT NULL AND ${users.lastActiveAt} < NOW() - INTERVAL '30 days'`);
        }
        if (input.pendingInvite) {
          // B2B guests created via inviteExternalUser but never claimed: no Azure
          // externalId stamped (Azure B2B handoff incomplete) and never logged in.
          filters.push(eq(users.isExternal, true));
          filters.push(sql`${users.externalId} IS NULL`);
          filters.push(sql`${users.lastActiveAt} IS NULL`);
        }
        if (input.excludePending) {
          // Hide unclaimed B2B invites from the main roster — they live in the
          // dedicated B2B Guest invites panel until Azure handoff completes.
          filters.push(sql`NOT (${users.isExternal} = true AND ${users.externalId} IS NULL AND ${users.lastActiveAt} IS NULL)`);
        }
        if (input.isExternal !== undefined) {
          filters.push(eq(users.isExternal, input.isExternal));
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
            isExternal: users.isExternal,
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
  //
  // External (B2B guest) admins must not see the internal admin roster — names
  // and emails are sensitive. The `destructive_admin` capability enforces the
  // gate (operators bypass; non-operator guests get FORBIDDEN). Guests keep
  // read access to the rest of the admin UI.
  listAdmins: partnerAdminProcedure
    .query(async ({ ctx }) => {
      const actor = trpcActor(ctx, { capability: 'destructive_admin' });

      const rows = await db
        .select({
          membershipId: memberships.id,
          userId: users.id,
          name: users.name,
          email: users.email,
          isExternal: users.isExternal,
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

      // Counts mirror the AdminTeam roster (excludes admins + unclaimed B2B
      // invites — those live in the B2B Guest invites panel until accepted).
      const rows = await db
        .select({
          role: memberships.role,
          count: sql<number>`count(*)::int`,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(and(
          eq(memberships.partnerId, partnerId),
          ne(memberships.role, 'admin'),
          sql`NOT (${users.isExternal} = true AND ${users.externalId} IS NULL AND ${users.lastActiveAt} IS NULL)`,
        ))
        .groupBy(memberships.role);

      // Stale guest seats = B2B support members inactive 30+ days. Internal
      // users excluded — Azure lifecycle handles their cleanup.
      const dormantRow = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(and(
          eq(memberships.partnerId, partnerId),
          eq(users.isExternal, true),
          eq(memberships.role, 'support'),
          sql`${users.lastActiveAt} IS NOT NULL AND ${users.lastActiveAt} < NOW() - INTERVAL '30 days'`,
        ));
      const dormant = dormantRow[0]?.count ?? 0;

      // Active B2B guest seats — any role (admins can also be external via
      // inviteExternalUser). Pending invites excluded — they live in the B2B
      // Guest invites panel until Azure handoff completes.
      const guestsRow = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(and(
          eq(memberships.partnerId, partnerId),
          eq(users.isExternal, true),
          sql`NOT (${users.externalId} IS NULL AND ${users.lastActiveAt} IS NULL)`,
        ));
      const guests = guestsRow[0]?.count ?? 0;

      let total = 0, support = 0, agents = 0;
      for (const row of rows) {
        total += row.count;
        if (row.role === 'support') support += row.count;
        if (row.role === 'agent') agents += row.count;
      }
      return { total, support, agents, dormant, guests };
    }),
});
