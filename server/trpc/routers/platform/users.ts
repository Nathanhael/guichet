import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { users, memberships, partners } from '../../../db/schema.js';
import { eq, desc, sql, isNull, and, inArray } from 'drizzle-orm';

export const platformUsersRouter = router({
  listGlobalUsers: platformProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(200).default(100),
    }).optional())
    .query(async ({ input }) => {
    const limit = input?.limit ?? 100;
    const cursor = input?.cursor;

    const userColumns = {
      id: users.id,
      email: users.email,
      externalId: users.externalId,
      name: users.name,
      lang: users.lang,
      avatarUrl: users.avatarUrl,
      isPlatformOperator: users.isPlatformOperator,
      lastActiveAt: users.lastActiveAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
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

    const userIds = pageUsers.map(u => u.id);
    const allMemberships = userIds.length > 0
      ? await db
          .select({
            id: memberships.id,
            userId: memberships.userId,
            partnerId: memberships.partnerId,
            partnerName: partners.name,
            role: memberships.role,
            departments: memberships.departments,
            source: memberships.source
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
});
