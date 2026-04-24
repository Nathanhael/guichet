import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { memberships } from '../db/schema.js';

export async function assertMembership(
  userId: string,
  partnerId: string,
  isPlatformOperator: boolean,
): Promise<void> {
  if (isPlatformOperator) return;
  const rows = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, partnerId)))
    .limit(1);
  if (rows.length === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'not a member of this partner' });
  }
}
