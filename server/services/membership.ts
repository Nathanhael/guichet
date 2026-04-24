import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { db } from '../db.js';
import { memberships, tickets } from '../db/schema.js';

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

export type TicketRow = typeof tickets.$inferSelect;

type LoadTicketCtx = { user: { partnerId?: string | null } };

export async function loadTicketForUser(
  ticketId: string,
  ctx: LoadTicketCtx,
): Promise<TicketRow> {
  const rows = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (rows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'ticket not found' });
  }
  const row = rows[0] as TicketRow;
  if (row.partnerId !== ctx.user.partnerId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'ticket belongs to another partner' });
  }
  return row;
}
