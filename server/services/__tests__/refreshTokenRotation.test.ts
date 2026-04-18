import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const {
  dbExecuteMock,
  dbInsertMock,
  dbSelectMock,
  dbUpdateMock,
  insertValuesMock,
  updateSetMock,
  updateWhereMock,
  selectLimitMock,
  insertedRows,
  executedStatements,
} = vi.hoisted(() => {
  const insertedRows: unknown[] = [];
  const executedStatements: Array<{ sql: string; params: unknown[] }> = [];

  // db.execute(sql`...`) — used for atomic UPDATE ... RETURNING
  const dbExecuteMock = vi.fn();

  // db.insert(t).values(row)
  const insertValuesMock = vi.fn().mockImplementation((row: unknown) => {
    insertedRows.push(row);
    return Promise.resolve(undefined);
  });
  const dbInsertMock = vi.fn().mockReturnValue({ values: insertValuesMock });

  // db.select(cols).from(t).where(pred).limit(n) — used for reuse detection lookup
  const selectLimitMock = vi.fn();
  const selectWhereMock = vi.fn().mockReturnValue({ limit: selectLimitMock });
  const selectFromMock = vi.fn().mockReturnValue({ where: selectWhereMock });
  const dbSelectMock = vi.fn().mockReturnValue({ from: selectFromMock });

  // db.update(t).set(vals).where(pred) — used by revokeFamily
  const updateWhereMock = vi.fn().mockResolvedValue(undefined);
  const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
  const dbUpdateMock = vi.fn().mockReturnValue({ set: updateSetMock });

  return {
    dbExecuteMock,
    dbInsertMock,
    dbSelectMock,
    dbUpdateMock,
    insertValuesMock,
    updateSetMock,
    updateWhereMock,
    selectLimitMock,
    insertedRows,
    executedStatements,
  };
});

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../db.js', () => ({
  db: {
    execute: dbExecuteMock,
    insert: dbInsertMock,
    select: dbSelectMock,
    update: dbUpdateMock,
  },
}));

vi.mock('../../db/schema.js', () => ({
  refreshTokens: {
    id: { name: 'id' },
    userId: { name: 'userId' },
    tokenHash: { name: 'tokenHash' },
    family: { name: 'family' },
    partnerId: { name: 'partnerId' },
    expiresAt: { name: 'expiresAt' },
    revokedAt: { name: 'revokedAt' },
    createdAt: { name: 'createdAt' },
  },
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    eq: vi.fn((col: unknown, val: unknown) => ({ __op: 'eq', col, val })),
    and: vi.fn((...args: unknown[]) => ({ __op: 'and', args })),
    isNull: vi.fn((col: unknown) => ({ __op: 'isNull', col })),
    lt: vi.fn((col: unknown, val: unknown) => ({ __op: 'lt', col, val })),
  };
});

vi.mock('../../config.js', () => ({
  default: {
    REFRESH_TOKEN_EXPIRY: '7d',
    ACCESS_TOKEN_EXPIRY: '15m',
    JWT_SECRET: 'test-secret-key-that-is-long-enough-for-hs256',
  },
}));

vi.mock('../authSession.js', () => ({
  // Pass-through: returns seconds for a '7d' / '15m' style string. Simplified
  // for tests — we don't care about boundary behavior here.
  parseExpiryToSeconds: vi.fn((s: string) => {
    if (s === '7d') return 7 * 24 * 3600;
    if (s === '15m') return 900;
    return 3600;
  }),
}));

vi.mock('../../utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ── Import SUT AFTER mocks ───────────────────────────────────────────────

import {
  createRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  revokeAllUserRefreshTokens,
} from '../refreshToken.js';
import logger from '../../utils/logger.js';
import crypto from 'crypto';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

describe('refreshToken service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.length = 0;
    executedStatements.length = 0;
    // Re-wire mock implementations (cleared above)
    insertValuesMock.mockImplementation((row: unknown) => {
      insertedRows.push(row);
      return Promise.resolve(undefined);
    });
    updateWhereMock.mockResolvedValue(undefined);
  });

  // ── createRefreshToken ──────────────────────────────────────────────────

  describe('createRefreshToken', () => {
    it('stores the SHA-256 hash — never the raw token', async () => {
      const { token } = await createRefreshToken('u1', 'p1');

      expect(insertedRows).toHaveLength(1);
      const row = insertedRows[0] as { tokenHash: string; userId: string; partnerId: string | null };
      expect(row.tokenHash).toBe(sha256(token));
      expect(row.tokenHash).not.toBe(token);
      expect(row.userId).toBe('u1');
      expect(row.partnerId).toBe('p1');
    });

    it('generates a unique family per token creation (separate family ids)', async () => {
      const a = await createRefreshToken('u1');
      const b = await createRefreshToken('u1');
      expect(a.family).not.toBe(b.family);
      expect(a.token).not.toBe(b.token);
    });

    it('sets expiresAt from config.REFRESH_TOKEN_EXPIRY (7d default)', async () => {
      const before = Date.now();
      const { expiresAt } = await createRefreshToken('u1');
      const after = Date.now();
      const expiryMs = new Date(expiresAt).getTime();

      // 7 days ± (test wall-clock slop)
      const sevenDays = 7 * 24 * 3600 * 1000;
      expect(expiryMs).toBeGreaterThanOrEqual(before + sevenDays - 1000);
      expect(expiryMs).toBeLessThanOrEqual(after + sevenDays + 1000);
    });

    it('defaults partnerId to null when omitted', async () => {
      await createRefreshToken('u1');
      const row = insertedRows[0] as { partnerId: string | null };
      expect(row.partnerId).toBeNull();
    });
  });

  // ── rotateRefreshToken — happy path ─────────────────────────────────────

  describe('rotateRefreshToken — happy path', () => {
    it('atomically claims the old token and issues a new one in the same family', async () => {
      const futureExpiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      dbExecuteMock.mockResolvedValueOnce({
        rows: [{
          id: 'rt-1',
          user_id: 'u1',
          token_hash: 'old-hash',
          family: 'fam-1',
          partner_id: 'p1',
          expires_at: futureExpiry,
          created_at: new Date().toISOString(),
        }],
      });

      const result = await rotateRefreshToken('old-raw-token');

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('u1');
      expect(result!.family).toBe('fam-1');
      expect(result!.partnerId).toBe('p1');
      expect(result!.token).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex
      expect(result!.token).not.toBe('old-raw-token');

      // A new row was inserted with the hash of the new token
      expect(insertedRows).toHaveLength(1);
      const newRow = insertedRows[0] as { tokenHash: string; family: string; userId: string };
      expect(newRow.tokenHash).toBe(sha256(result!.token));
      expect(newRow.family).toBe('fam-1'); // same family as the claimed token
      expect(newRow.userId).toBe('u1');

      // Reuse detection lookup is NOT performed on happy path
      expect(dbSelectMock).not.toHaveBeenCalled();
      expect(dbUpdateMock).not.toHaveBeenCalled();
    });
  });

  // ── rotateRefreshToken — reuse detection ───────────────────────────────

  describe('rotateRefreshToken — reuse detection (CRITICAL SECURITY)', () => {
    it('revokes the ENTIRE family when a previously-consumed token is replayed', async () => {
      // Atomic claim returns 0 rows — token either never existed or was already revoked.
      dbExecuteMock.mockResolvedValueOnce({ rows: [] });
      // Follow-up select finds the token in the table → it WAS a real token, now revoked → REUSE.
      selectLimitMock.mockResolvedValueOnce([{ family: 'fam-compromised' }]);

      const result = await rotateRefreshToken('replayed-token');

      expect(result).toBeNull();

      // revokeFamily path must have fired: update() called with family predicate
      expect(dbUpdateMock).toHaveBeenCalledTimes(1);
      expect(updateSetMock).toHaveBeenCalledWith({ revokedAt: expect.any(String) });

      // Warn-log must have named the compromised family for ops visibility
      expect(logger.warn).toHaveBeenCalledWith(
        { family: 'fam-compromised' },
        expect.stringMatching(/reuse detected/i),
      );

      // No new token was issued — reuse must NEVER produce a fresh access path
      expect(insertedRows).toHaveLength(0);
    });

    it('does NOT revoke any family when the token is simply unknown (never existed)', async () => {
      dbExecuteMock.mockResolvedValueOnce({ rows: [] });
      // Follow-up select also finds nothing → this is noise, not a replay.
      selectLimitMock.mockResolvedValueOnce([]);

      const result = await rotateRefreshToken('totally-bogus-token');

      expect(result).toBeNull();
      expect(dbUpdateMock).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(insertedRows).toHaveLength(0);
    });

    it('hashes the replayed token before lookup — raw token never touches a WHERE clause', async () => {
      dbExecuteMock.mockResolvedValueOnce({ rows: [] });
      selectLimitMock.mockResolvedValueOnce([]);

      const raw = 'raw-replay-attempt-token';
      await rotateRefreshToken(raw);

      // The UPDATE received the SHA-256 hash as a parameter, not the raw token
      const execArgs = dbExecuteMock.mock.calls[0][0] as { queryChunks?: unknown[] } | unknown;
      const asString = JSON.stringify(execArgs);
      expect(asString).toContain(sha256(raw));
      expect(asString).not.toContain(raw);
    });
  });

  // ── rotateRefreshToken — expired ────────────────────────────────────────

  describe('rotateRefreshToken — expired token', () => {
    it('returns null and does NOT issue a new token when the claimed token is past its expiry', async () => {
      const pastExpiry = new Date(Date.now() - 60_000).toISOString();
      dbExecuteMock.mockResolvedValueOnce({
        rows: [{
          id: 'rt-1',
          user_id: 'u1',
          token_hash: 'old-hash',
          family: 'fam-1',
          partner_id: null,
          expires_at: pastExpiry,
          created_at: new Date().toISOString(),
        }],
      });

      const result = await rotateRefreshToken('expired-token');

      expect(result).toBeNull();
      expect(insertedRows).toHaveLength(0);
      // No reuse-family revoke: the token was legitimately claimed, just stale.
      expect(dbUpdateMock).not.toHaveBeenCalled();
    });
  });

  // ── revokeFamily / revokeAllUserRefreshTokens ───────────────────────────

  describe('revokeFamily', () => {
    it('sets revokedAt on all still-active rows in the family', async () => {
      await revokeFamily('fam-xyz');

      expect(dbUpdateMock).toHaveBeenCalledTimes(1);
      expect(updateSetMock).toHaveBeenCalledWith({ revokedAt: expect.any(String) });
      // timestamp is an ISO 8601 string
      const setArg = updateSetMock.mock.calls[0][0] as { revokedAt: string };
      expect(() => new Date(setArg.revokedAt).toISOString()).not.toThrow();
    });
  });

  describe('revokeAllUserRefreshTokens', () => {
    it('revokes every still-active row for the user', async () => {
      await revokeAllUserRefreshTokens('u-lockout');

      expect(dbUpdateMock).toHaveBeenCalledTimes(1);
      expect(updateSetMock).toHaveBeenCalledWith({ revokedAt: expect.any(String) });
    });
  });
});
