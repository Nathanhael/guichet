/**
 * Dashboard onboarding mode — query layer.
 *
 * Single fan-out helper: counts closed tickets, counts non-admin team
 * members, fetches the partner's departments + business-hours config.
 * `buildOnboardingState` then folds those into the `{ isNewPartner, steps }`
 * payload.
 *
 * "non-admin staff" = `support` or `agent` role memberships. `admin` is
 * the bootstrap account that gets created on partner provisioning, so
 * counting it would mean every partner ships pre-onboarded.
 */

import { and, count, eq, ne } from 'drizzle-orm';
import { db } from '../../db.js';
import { memberships, partners, tickets } from '../../db/schema.js';
import type { OnboardingDept } from './onboarding.js';

export interface OnboardingData {
  closedTicketCount: number;
  nonAdminStaffCount: number;
  departments: OnboardingDept[];
  businessHoursSchedule: unknown;
}

interface PartnerDept {
  id: string;
  name?: string;
  sla?: { enabled?: boolean; firstResponseMinutes?: number };
}

export async function fetchOnboardingData(partnerId: string): Promise<OnboardingData> {
  const [partnerRow, ticketCountRow, staffCountRow] = await Promise.all([
    db
      .select({
        departments: partners.departments,
        businessHoursSchedule: partners.businessHoursSchedule,
      })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1),
    db
      .select({ value: count() })
      .from(tickets)
      .where(
        and(eq(tickets.partnerId, partnerId), eq(tickets.status, 'closed')),
      ),
    db
      .select({ value: count() })
      .from(memberships)
      .where(
        and(
          eq(memberships.partnerId, partnerId),
          ne(memberships.role, 'admin'),
          ne(memberships.role, 'platform_operator'),
        ),
      ),
  ]);

  const partnerDepts = (partnerRow[0]?.departments as PartnerDept[] | null) ?? [];
  const departments: OnboardingDept[] = partnerDepts
    .filter((d) => d?.id)
    .map((d) => ({
      id: d.id,
      name: d.name ?? d.id,
      sla: d.sla
        ? {
            enabled: d.sla.enabled === true,
            firstResponseMinutes: d.sla.firstResponseMinutes ?? 0,
          }
        : undefined,
    }));

  return {
    closedTicketCount: Number(ticketCountRow[0]?.value ?? 0),
    nonAdminStaffCount: Number(staffCountRow[0]?.value ?? 0),
    departments,
    businessHoursSchedule: partnerRow[0]?.businessHoursSchedule ?? null,
  };
}
