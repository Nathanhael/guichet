import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from '../../db/schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, typeof schema, any>;

export interface FlipDeps {
  db: AnyDb;
  revokeUserSessions: (userId: string) => Promise<unknown>;
}

export interface FlipResult {
  flipped: boolean;
}

export function createFlipIsExternal(_deps: FlipDeps) {
  return async (_userId: string, _nextValue: boolean): Promise<FlipResult> => {
    throw new Error('not implemented');
  };
}
