/**
 * Refresh Token Infrastructure Tests (#43)
 *
 * Verifies:
 * - config has ACCESS_TOKEN_EXPIRY and REFRESH_TOKEN_EXPIRY
 * - schema has refreshTokens table with correct columns
 * - refreshToken.ts service exports expected functions
 */

import { describe, it, expect } from 'vitest';

describe('Refresh Token Infrastructure', () => {
  describe('config.ts', () => {
    it('exports ACCESS_TOKEN_EXPIRY with default 15m', async () => {
      const { default: config } = await import('../../config.js');
      expect((config as Record<string, unknown>).ACCESS_TOKEN_EXPIRY).toBeDefined();
      expect((config as Record<string, unknown>).ACCESS_TOKEN_EXPIRY).toBe('15m');
    });

    it('exports REFRESH_TOKEN_EXPIRY with default 7d', async () => {
      const { default: config } = await import('../../config.js');
      expect((config as Record<string, unknown>).REFRESH_TOKEN_EXPIRY).toBeDefined();
      expect((config as Record<string, unknown>).REFRESH_TOKEN_EXPIRY).toBe('7d');
    });
  });

  describe('db/schema.ts', () => {
    it('exports refreshTokens table', async () => {
      const schema = await import('../../db/schema.js');
      expect(schema.refreshTokens).toBeDefined();
    });

    it('refreshTokens table has tokenHash column', async () => {
      const schema = await import('../../db/schema.js');
      const table = schema.refreshTokens;
      const { getTableColumns } = await import('drizzle-orm');
      const cols = getTableColumns(table);
      expect(cols).toHaveProperty('tokenHash');
    });

    it('refreshTokens table has family column', async () => {
      const schema = await import('../../db/schema.js');
      const table = schema.refreshTokens;
      const { getTableColumns } = await import('drizzle-orm');
      const cols = getTableColumns(table);
      expect(cols).toHaveProperty('family');
    });

    it('refreshTokens table has userId, expiresAt, revokedAt, createdAt columns', async () => {
      const schema = await import('../../db/schema.js');
      const table = schema.refreshTokens;
      const { getTableColumns } = await import('drizzle-orm');
      const cols = getTableColumns(table);
      expect(cols).toHaveProperty('userId');
      expect(cols).toHaveProperty('expiresAt');
      expect(cols).toHaveProperty('revokedAt');
      expect(cols).toHaveProperty('createdAt');
    });
  });

  describe('services/refreshToken.ts', () => {
    it('exports createRefreshToken function', async () => {
      const mod = await import('./refreshToken.js');
      expect(typeof mod.createRefreshToken).toBe('function');
    });

    it('exports rotateRefreshToken function', async () => {
      const mod = await import('./refreshToken.js');
      expect(typeof mod.rotateRefreshToken).toBe('function');
    });

    it('exports revokeFamily function', async () => {
      const mod = await import('./refreshToken.js');
      expect(typeof mod.revokeFamily).toBe('function');
    });

    it('exports revokeAllUserRefreshTokens function', async () => {
      const mod = await import('./refreshToken.js');
      expect(typeof mod.revokeAllUserRefreshTokens).toBe('function');
    });
  });
});
