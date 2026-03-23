import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { memberships, partners, users } from '../db/schema.js';
import config from '../config.js';

export interface SessionMembership {
  id: string;
  partnerId: string;
  role: string;
  departments: unknown;
  partnerName: string;
  logoUrl: string | null;
  industry: string | null;
  partnerDepartments: unknown;
  status: string;
}

export async function listUserMemberships(userId: string): Promise<SessionMembership[]> {
  return db
    .select({
      id: memberships.id,
      partnerId: memberships.partnerId,
      role: memberships.role,
      departments: memberships.departments,
      partnerName: partners.name,
      logoUrl: partners.logoUrl,
      industry: partners.industry,
      partnerDepartments: partners.departments,
      status: partners.status,
    })
    .from(memberships)
    .innerJoin(partners, eq(memberships.partnerId, partners.id))
    .where(eq(memberships.userId, userId));
}

export function buildAuthToken(input: {
  userId: string;
  role: string;
  departments?: unknown[];
  partnerId?: string;
  membershipId?: string;
  isPlatformOperator: boolean;
  platformStepUpAt?: number;
}): string {
  const jti = crypto.randomUUID();
  return jwt.sign(
    {
      jti,
      userId: input.userId,
      role: input.role,
      departments: input.departments || [],
      partnerId: input.partnerId,
      membershipId: input.membershipId,
      isPlatformOperator: input.isPlatformOperator,
      platformStepUpAt: input.platformStepUpAt,
    },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRY } as jwt.SignOptions
  );
}

export function buildAuthResponse(input: {
  token: string;
  user: {
    id: string;
    name: string;
    lang: string | null;
    isPlatformOperator: boolean | null;
  };
  memberships: SessionMembership[];
}) {
  const activeMemberships = input.memberships.filter((m) => m.status === 'active');
  const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

  return {
    token: input.token,
    user: {
      id: input.user.id,
      name: input.user.name,
      lang: input.user.lang,
      isPlatformOperator: !!input.user.isPlatformOperator,
    },
    memberships: activeMemberships.map((m) => ({
      id: m.id,
      partnerId: m.partnerId,
      partnerName: m.partnerName,
      role: m.role,
      departments: m.departments || [],
      manifest: {
        industry: m.industry,
        logoUrl: m.logoUrl,
        departments: m.partnerDepartments || [],
      },
    })),
    activePartnerId: defaultMembership?.partnerId,
  };
}

export async function findUserByEmail(email: string) {
  // Use lower() + eq() for case-insensitive matching instead of ilike()
  // to prevent LIKE wildcard injection (e.g. '%@evil.com')
  const rows = await db.select().from(users).where(
    eq(sql`lower(${users.email})`, email.toLowerCase())
  ).limit(1);
  return rows[0];
}

export async function getEnterPartnerContext(partnerId: string) {
  const rows = await db
    .select({
      id: partners.id,
      name: partners.name,
      status: partners.status,
      logoUrl: partners.logoUrl,
      industry: partners.industry,
      partnerDepartments: partners.departments,
    })
    .from(partners)
    .where(and(eq(partners.id, partnerId), isNull(partners.deletedAt)))
    .limit(1);

  return rows[0];
}
