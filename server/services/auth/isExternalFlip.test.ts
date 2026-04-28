import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq, and, desc } from 'drizzle-orm';

import { auditLog, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { createFlipIsExternal } from './isExternalFlip.js';

let handle: TestDbHandle;

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('flipIsExternal — actual flip', () => {
  it('updates users.isExternal and writes auth.session_revoked audit row when value changes', async () => {
    await handle.db.insert(users).values({
      id: 'u-flip',
      email: 'flip@x.test',
      name: 'Flip User',
      isExternal: false,
    });

    const revokeMock = vi.fn().mockResolvedValue(0);
    const flip = createFlipIsExternal({ db: handle.db, revokeUserSessions: revokeMock });

    const result = await flip('u-flip', true);

    expect(result.flipped).toBe(true);

    const [row] = await handle.db
      .select({ isExternal: users.isExternal })
      .from(users)
      .where(eq(users.id, 'u-flip'));
    expect(row.isExternal).toBe(true);

    const [audit] = await handle.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'auth.session_revoked'), eq(auditLog.targetId, 'u-flip')))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    expect(audit).toBeDefined();
    expect(audit.actorId).toBe('u-flip');
    expect(audit.targetType).toBe('user');
    expect((audit.metadata as Record<string, unknown>).reason).toBe('isExternal_flip');
    expect((audit.metadata as Record<string, unknown>).from).toBe(false);
    expect((audit.metadata as Record<string, unknown>).to).toBe(true);
  });

  it('flips in the reverse direction (true → false) just as well', async () => {
    await handle.db.insert(users).values({
      id: 'u-flip-back',
      email: 'flipback@x.test',
      name: 'Flip Back',
      isExternal: true,
    });

    const revokeMock = vi.fn().mockResolvedValue(0);
    const flip = createFlipIsExternal({ db: handle.db, revokeUserSessions: revokeMock });

    const result = await flip('u-flip-back', false);

    expect(result.flipped).toBe(true);

    const [row] = await handle.db
      .select({ isExternal: users.isExternal })
      .from(users)
      .where(eq(users.id, 'u-flip-back'));
    expect(row.isExternal).toBe(false);
  });
});
