/**
 * PR 0 acceptance spike: prove PGLite + Drizzle migrations work for the
 * lifecycle test substrate. If this file boots cleanly and the round-trip
 * passes, the substrate is viable for the lifecycle suite (PR 1+).
 *
 * If migrations fail, types misalign, or transactions misbehave, the fallback
 * is a docker-compose Postgres test container (documented in the parent PRD).
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { partners, tickets, users } from '../db/schema.js';
import { createTestDb } from './pglite-setup.js';

describe('pglite spike', () => {
  it('boots PGLite, applies Drizzle migrations, and round-trips a ticket row', async () => {
    const t0 = performance.now();
    const handle = await createTestDb();
    const bootMs = performance.now() - t0;
    // Documented target: ~100ms per file. Logged for visibility, not asserted —
    // CI machines vary. The hard signal is "boots at all + migrations apply".
    console.log(`[pglite] boot+migrate took ${bootMs.toFixed(1)}ms`);

    try {
      await handle.db.insert(partners).values({
        id: 'p_test',
        name: 'Test Partner',
        status: 'active',
      });

      await handle.db.insert(users).values({
        id: 'u_agent',
        email: 'agent@test.local',
        name: 'Test Agent',
      });

      await handle.db.insert(tickets).values({
        id: 't_spike',
        partnerId: 'p_test',
        dept: 'general',
        agentId: 'u_agent',
        agentName: 'Test Agent',
        status: 'open',
      });

      const rows = await handle.db
        .select()
        .from(tickets)
        .where(eq(tickets.id, 't_spike'));

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: 't_spike',
        partnerId: 'p_test',
        dept: 'general',
        agentId: 'u_agent',
        status: 'open',
      });
    } finally {
      await handle.close();
    }
  });

  it('rolls back a transaction cleanly — no partial state visible', async () => {
    const handle = await createTestDb();

    try {
      await handle.db.insert(partners).values({
        id: 'p_tx',
        name: 'Tx Partner',
        status: 'active',
      });
      await handle.db.insert(users).values({
        id: 'u_tx',
        email: 'tx@test.local',
        name: 'Tx Agent',
      });

      const sentinel = new Error('boom');
      await expect(
        handle.db.transaction(async (tx) => {
          await tx.insert(tickets).values({
            id: 't_rollback',
            partnerId: 'p_tx',
            dept: 'general',
            agentId: 'u_tx',
            status: 'open',
          });
          throw sentinel;
        }),
      ).rejects.toBe(sentinel);

      const rows = await handle.db
        .select()
        .from(tickets)
        .where(eq(tickets.id, 't_rollback'));
      expect(rows).toHaveLength(0);
    } finally {
      await handle.close();
    }
  });
});
