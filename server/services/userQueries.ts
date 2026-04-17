import { eq, and } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { users, memberships } from '../db/schema.js';

/**
 * Fetches user name and platform operator flag.
 * Used by: socket:identify
 */
export async function findUserById(userId: string) {
  const rows = await db
    .select({ name: users.name, isPlatformOperator: users.isPlatformOperator })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0];
}

/**
 * Fetches membership role for a user in a specific partner.
 * Used by: socket:identify
 */
export async function findMembership(userId: string, partnerId: string) {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, partnerId)));
  return rows[0];
}

/**
 * Fetches sender display info (name, role, lang) by JOINing users + memberships.
 * Used by: message:send
 */
export async function findSenderInfo(userId: string, partnerId: string) {
  const rows = await db
    .select({
      name: users.name,
      role: memberships.role,
      lang: users.lang,
      isExternal: users.isExternal,
    })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.partnerId, partnerId)))
    .where(eq(users.id, userId));
  return rows[0];
}

/**
 * Fetches just the user's name.
 * Used by: ticket:new (agent name lookup)
 */
export async function findUserName(userId: string) {
  const rows = await db
    .select({ name: users.name, isExternal: users.isExternal })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0];
}

/**
 * Fetches target user name for ticket transfer validation.
 * Verifies user exists and has a membership in the partner (any role).
 * Role-based authorization is handled by the caller.
 * Used by: ticket:transfer
 */
export async function findTargetSupport(userId: string, partnerId: string) {
  const rows = await db
    .select({ name: users.name })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.partnerId, partnerId)))
    .where(eq(users.id, userId));
  return rows[0];
}
