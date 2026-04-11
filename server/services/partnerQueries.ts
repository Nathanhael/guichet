import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { partners } from '../db/schema.js';

/**
 * Fetches partner configuration for business hours and status checks.
 * Used by: socket:identify, ticket:new
 */
export async function findPartnerConfig(partnerId: string) {
  const rows = await db
    .select({
      status: partners.status,
      businessHoursSchedule: partners.businessHoursSchedule,
      businessHoursStart: partners.businessHoursStart,
      businessHoursEnd: partners.businessHoursEnd,
      businessHoursTimezone: partners.businessHoursTimezone,
    })
    .from(partners)
    .where(eq(partners.id, partnerId));
  return rows[0];
}
