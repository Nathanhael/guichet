import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectQueue: unknown[] = [];
const insertValuesMock = vi.fn();
const updateWhereMock = vi.fn();

const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectQueue.shift()),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: insertValuesMock,
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: updateWhereMock,
    })),
  })),
};

vi.mock('../db.js', () => ({
  db: dbMock,
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./mail.js', () => ({
  MailService: {
    sendAccountLocked: vi.fn(async () => true),
  },
}));

describe('checkLockout', () => {
  it('returns not locked when lockedUntil is null', async () => {
    const { checkLockout } = await import('./accountLockout.js');
    const result = checkLockout({ lockedUntil: null });
    expect(result).toEqual({ locked: false });
  });

  it('returns not locked when lockedUntil is undefined', async () => {
    const { checkLockout } = await import('./accountLockout.js');
    const result = checkLockout({});
    expect(result).toEqual({ locked: false });
  });

  it('returns not locked when lock has expired', async () => {
    const { checkLockout } = await import('./accountLockout.js');
    const pastDate = new Date(Date.now() - 60000).toISOString();
    const result = checkLockout({ lockedUntil: pastDate });
    expect(result).toEqual({ locked: false });
  });

  it('returns locked with retryAfterMs when lock is active', async () => {
    const { checkLockout } = await import('./accountLockout.js');
    const futureDate = new Date(Date.now() + 600000).toISOString();
    const result = checkLockout({ lockedUntil: futureDate });

    expect(result.locked).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(600000);
  });
});

describe('recordFailedLogin', () => {
  beforeEach(() => {
    selectQueue.length = 0;
    dbMock.select.mockClear();
    dbMock.insert.mockClear();
    dbMock.update.mockClear();
    insertValuesMock.mockReset();
    insertValuesMock.mockResolvedValue(undefined);
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('increments counter without locking when under threshold', async () => {
    // Return current attempt count = 2
    selectQueue.push([{ failedLoginAttempts: 2 }]);

    const { recordFailedLogin } = await import('./accountLockout.js');
    const result = await recordFailedLogin('user-1');

    expect(result).toEqual({ locked: false, attemptsLeft: 2 }); // 5 - 3 = 2
    expect(updateWhereMock).toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled(); // No audit log when not locked
  });

  it('locks account at 5th failed attempt', async () => {
    // Return current attempt count = 4 (this will be the 5th)
    selectQueue.push([{ failedLoginAttempts: 4 }]);
    // For the email lookup after locking
    selectQueue.push([{ email: 'user@test.com', name: 'Test User' }]);

    const { recordFailedLogin } = await import('./accountLockout.js');
    const result = await recordFailedLogin('user-1');

    expect(result).toEqual({ locked: true, attemptsLeft: 0 });
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'security.account_locked',
      actorId: 'user-1',
      targetType: 'user',
      targetId: 'user-1',
    }));
  });

  it('handles first failed attempt (null counter)', async () => {
    selectQueue.push([{ failedLoginAttempts: null }]);

    const { recordFailedLogin } = await import('./accountLockout.js');
    const result = await recordFailedLogin('user-1');

    expect(result).toEqual({ locked: false, attemptsLeft: 4 }); // 5 - 1 = 4
  });

  it('handles missing user row gracefully', async () => {
    selectQueue.push([]); // empty result

    const { recordFailedLogin } = await import('./accountLockout.js');
    const result = await recordFailedLogin('user-nonexistent');

    expect(result).toEqual({ locked: false, attemptsLeft: 4 }); // 0 + 1 = 1, 5-1=4
  });
});

describe('resetFailedLogins', () => {
  beforeEach(() => {
    updateWhereMock.mockReset();
    updateWhereMock.mockResolvedValue(undefined);
    dbMock.update.mockClear();
  });

  it('clears failed login counter and lock', async () => {
    const { resetFailedLogins } = await import('./accountLockout.js');
    await resetFailedLogins('user-1');

    expect(dbMock.update).toHaveBeenCalled();
    expect(updateWhereMock).toHaveBeenCalled();
  });
});
