import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

import { auditLog, users } from '../../db/schema.js';
import type * as schema from '../../db/schema.js';
import logger from '../../utils/logger.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, typeof schema, any>;

export interface FlipDeps {
  db: AnyDb;
  revokeUserSessions: (userId: string) => Promise<unknown>;
}

export interface FlipResult {
  flipped: boolean;
}

export function createFlipIsExternal(deps: FlipDeps) {
  return async (userId: string, nextValue: boolean): Promise<FlipResult> => {
    const result = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ isExternal: users.isExternal })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!row) {
        throw new Error(`flipIsExternal: user ${userId} not found`);
      }

      if (row.isExternal === nextValue) {
        return { flipped: false as const, prev: row.isExternal };
      }

      await tx.update(users).set({ isExternal: nextValue }).where(eq(users.id, userId));

      await tx.insert(auditLog).values({
        action: 'auth.session_revoked',
        actorId: userId,
        partnerId: null,
        targetType: 'user',
        targetId: userId,
        metadata: { reason: 'isExternal_flip', from: row.isExternal, to: nextValue },
      });

      return { flipped: true as const, prev: row.isExternal };
    });

    if (result.flipped) {
      try {
        await deps.revokeUserSessions(userId);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), userId },
          '[auth] flipIsExternal: revocation cascade failed (DB write committed)'
        );
      }
    }

    return { flipped: result.flipped };
  };
}
