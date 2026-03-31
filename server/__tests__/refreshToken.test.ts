/**
 * Refresh Token Infrastructure Tests (#43)
 *
 * Verifies:
 * - config has ACCESS_TOKEN_EXPIRY and REFRESH_TOKEN_EXPIRY
 * - schema has refreshTokens table with tokenHash and family
 * - auth routes have /refresh endpoint and tessera_refresh cookie
 * - refreshToken.ts service exists with rotateRefreshToken, revokeFamily, createRefreshToken
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

describe('Refresh Token Infrastructure', () => {
  describe('config.ts', () => {
    it('exports ACCESS_TOKEN_EXPIRY with default 15m', async () => {
      const { default: config } = await import('../config.js');
      expect((config as Record<string, unknown>).ACCESS_TOKEN_EXPIRY).toBeDefined();
      expect((config as Record<string, unknown>).ACCESS_TOKEN_EXPIRY).toBe('15m');
    });

    it('exports REFRESH_TOKEN_EXPIRY with default 7d', async () => {
      const { default: config } = await import('../config.js');
      expect((config as Record<string, unknown>).REFRESH_TOKEN_EXPIRY).toBeDefined();
      expect((config as Record<string, unknown>).REFRESH_TOKEN_EXPIRY).toBe('7d');
    });
  });

  describe('db/schema.ts', () => {
    it('exports refreshTokens table', async () => {
      const schema = await import('../db/schema.js');
      expect(schema.refreshTokens).toBeDefined();
    });

    it('refreshTokens table has tokenHash column', async () => {
      const schema = await import('../db/schema.js');
      const table = schema.refreshTokens;
      // Drizzle tables expose column definitions via getTableColumns
      const { getTableColumns } = await import('drizzle-orm');
      const cols = getTableColumns(table);
      expect(cols).toHaveProperty('tokenHash');
    });

    it('refreshTokens table has family column', async () => {
      const schema = await import('../db/schema.js');
      const table = schema.refreshTokens;
      const { getTableColumns } = await import('drizzle-orm');
      const cols = getTableColumns(table);
      expect(cols).toHaveProperty('family');
    });

    it('refreshTokens table has userId, expiresAt, revokedAt, createdAt columns', async () => {
      const schema = await import('../db/schema.js');
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
    it('service file exists', () => {
      const filePath = path.join(ROOT, 'services', 'refreshToken.ts');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('exports createRefreshToken function', async () => {
      const mod = await import('../services/refreshToken.js');
      expect(typeof mod.createRefreshToken).toBe('function');
    });

    it('exports rotateRefreshToken function', async () => {
      const mod = await import('../services/refreshToken.js');
      expect(typeof mod.rotateRefreshToken).toBe('function');
    });

    it('exports revokeFamily function', async () => {
      const mod = await import('../services/refreshToken.js');
      expect(typeof mod.revokeFamily).toBe('function');
    });

    it('exports revokeAllUserRefreshTokens function', async () => {
      const mod = await import('../services/refreshToken.js');
      expect(typeof mod.revokeAllUserRefreshTokens).toBe('function');
    });
  });

  describe('routes/auth.ts', () => {
    it('source file contains POST /refresh endpoint', () => {
      const authSrc = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
      expect(authSrc).toMatch(/router\.post\(['"](\/)?refresh['"]/);
    });

    it('source file sets tessera_refresh cookie', () => {
      const authSrc = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
      expect(authSrc).toMatch(/tessera_refresh/);
    });

    it('source file imports createRefreshToken', () => {
      const authSrc = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
      expect(authSrc).toMatch(/createRefreshToken/);
    });

    it('source file imports rotateRefreshToken', () => {
      const authSrc = fs.readFileSync(path.join(ROOT, 'routes', 'auth.ts'), 'utf8');
      expect(authSrc).toMatch(/rotateRefreshToken/);
    });
  });

  describe('migration', () => {
    it('squashed migration includes refresh_tokens table', () => {
      const sqlPath = path.join(ROOT, 'drizzle', '0000_cloudy_the_twelve.sql');
      expect(fs.existsSync(sqlPath)).toBe(true);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      expect(sql).toMatch(/CREATE TABLE.*refresh_tokens/);
    });
  });
});
