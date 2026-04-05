import { SignJWT } from 'jose';
import crypto from 'crypto';
import type { Response } from 'express';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { memberships, partners, users } from '../db/schema.js';
import config from '../config.js';

const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);

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
  authMethod: string;
}

export async function listUserMemberships(userId: string): Promise<SessionMembership[]> {
  // 1. Check if user is a platform operator
  const userResults = await db.select({ isPlatformOperator: users.isPlatformOperator }).from(users).where(eq(users.id, userId)).limit(1);
  const isPlatform = !!userResults[0]?.isPlatformOperator;

  if (isPlatform) {
    // 2. Platform operators get "virtual" memberships to all active partners
    const allPartners = await db
      .select({
        partnerId: partners.id,
        partnerName: partners.name,
        logoUrl: partners.logoUrl,
        industry: partners.industry,
        partnerDepartments: partners.departments,
        status: partners.status,
        authMethod: partners.authMethod,
      })
      .from(partners)
      .where(eq(partners.status, 'active'));

    return allPartners.map((p) => ({
      id: `virtual_platform_${userId}_${p.partnerId}`,
      userId,
      partnerId: p.partnerId,
      role: 'admin',
      departments: [], // Platform admins see all by default
      partnerName: p.partnerName,
      logoUrl: p.logoUrl,
      industry: p.industry,
      partnerDepartments: p.partnerDepartments,
      status: p.status,
      authMethod: p.authMethod,
    }));
  }

  // 3. Regular users use explicit memberships
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
      authMethod: partners.authMethod,
    })
    .from(memberships)
    .innerJoin(partners, eq(memberships.partnerId, partners.id))
    .where(and(
      eq(memberships.userId, userId),
      eq(partners.status, 'active')
    ));
}

export async function buildAuthToken(input: {
  userId: string;
  role: string;
  departments?: unknown[];
  partnerId?: string;
  membershipId?: string;
  isPlatformOperator: boolean;
  platformStepUpAt?: number;
}): Promise<string> {
  const jti = crypto.randomUUID();
  const expiresIn = config.ACCESS_TOKEN_EXPIRY || '15m';
  return new SignJWT({
      jti,
      userId: input.userId,
      role: input.role,
      departments: input.departments || [],
      partnerId: input.partnerId,
      membershipId: input.membershipId,
      isPlatformOperator: input.isPlatformOperator,
      platformStepUpAt: input.platformStepUpAt,
    })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(jwtSecret);
}

export function buildAuthResponse(input: {
  user: {
    id: string;
    name: string;
    email: string;
    lang: string | null;
    isPlatformOperator: boolean | null;
    accessibilityPrefs?: Record<string, unknown> | null;
  };
  memberships: SessionMembership[];
}) {
  const activeMemberships = input.memberships.filter((m) => m.status === 'active');
  const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

  return {
    user: {
      id: input.user.id,
      name: input.user.name,
      email: input.user.email,
      lang: input.user.lang,
      isPlatformOperator: !!input.user.isPlatformOperator,
      accessibilityPrefs: input.user.accessibilityPrefs ?? null,
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
        authMethod: m.authMethod,
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

const COOKIE_NAME = 'tessera_token';
const EXPIRY_COOKIE_NAME = 'session_expires';

function cookieOptions(httpOnly: boolean) {
  return {
    httpOnly,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

/** Parse expiry string (e.g. '15m', '7d', '3600') into seconds */
export function parseExpiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)(s|m|h|d)?$/);
  if (!match) return 86400;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return value * 86400;
    case 'h': return value * 3600;
    case 'm': return value * 60;
    case 's': default: return value;
  }
}

export function setAuthCookie(res: Response, token: string, expiresInSeconds: number): void {
  const maxAgeMs = expiresInSeconds * 1000;
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(true), maxAge: maxAgeMs });
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  res.cookie(EXPIRY_COOKIE_NAME, String(expiresAt), { ...cookieOptions(false), maxAge: maxAgeMs });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions(true));
  res.clearCookie(EXPIRY_COOKIE_NAME, cookieOptions(false));
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
