import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { partners, tickets } from '../db/schema.js';

export interface PartnerDepartment {
  id: string;
  name: string;
  description?: string;
}

/**
 * Fetches the departments JSONB array for a partner.
 */
export async function findPartnerDepartments(partnerId: string): Promise<PartnerDepartment[]> {
  const rows = await db
    .select({ departments: partners.departments })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1);

  if (!rows.length) return [];
  return (rows[0].departments as PartnerDepartment[]) || [];
}

/**
 * Transfers a ticket to a new department.
 * Clears support assignment and re-opens the ticket. Bumps queue_entered_at
 * so the ticket joins the new department's queue at NOW() instead of
 * jumping ahead based on its original creation time.
 */
export async function transferTicketToDepartment(ticketId: string, departmentId: string): Promise<void> {
  await db
    .update(tickets)
    .set({
      dept: departmentId,
      supportId: null,
      supportName: null,
      status: 'open',
      queueEnteredAt: new Date().toISOString(),
    })
    .where(eq(tickets.id, ticketId));
}
