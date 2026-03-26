import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildAuthResponse, buildAuthToken, parseExpiryToSeconds, setAuthCookie, clearAuthCookie } from './authSession.js';

describe('auth session helpers', () => {
  it('builds a consistent JWT payload for tenant-scoped sessions', () => {
    const token = buildAuthToken({
      userId: 'user-1',
      role: 'support',
      departments: ['billing'],
      partnerId: 'tenant-a',
      membershipId: 'mem-1',
      isPlatformOperator: false,
    });

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as Record<string, unknown>;

    expect(decoded.userId).toBe('user-1');
    expect(typeof decoded.jti).toBe('string');
    expect(decoded.role).toBe('support');
    expect(decoded.partnerId).toBe('tenant-a');
    expect(decoded.membershipId).toBe('mem-1');
    expect(decoded.isPlatformOperator).toBe(false);
    expect(decoded.departments).toEqual(['billing']);
  });

  it('filters inactive memberships from the auth response and picks the first active partner', () => {
    const response = buildAuthResponse({
      token: 'signed-token',
      user: {
        id: 'user-1',
        name: 'Alice',
        lang: 'en',
        isPlatformOperator: false,
      },
      memberships: [
        {
          id: 'mem-inactive',
          partnerId: 'tenant-z',
          role: 'agent',
          departments: [],
          partnerName: 'Tenant Z',
          logoUrl: null,
          industry: 'retail',
          partnerDepartments: [],
          status: 'inactive',
        },
        {
          id: 'mem-active',
          partnerId: 'tenant-a',
          role: 'support',
          departments: ['billing'],
          partnerName: 'Tenant A',
          logoUrl: null,
          industry: 'telecom',
          partnerDepartments: [{ id: 'billing', name: 'Billing' }],
          status: 'active',
        },
      ],
    });

    expect(response.token).toBe('signed-token');
    expect(response.user).toEqual({
      id: 'user-1',
      name: 'Alice',
      lang: 'en',
      isPlatformOperator: false,
    });
    expect(response.memberships).toHaveLength(1);
    expect(response.memberships[0]).toMatchObject({
      id: 'mem-active',
      partnerId: 'tenant-a',
      role: 'support',
      partnerName: 'Tenant A',
    });
    expect(response.activePartnerId).toBe('tenant-a');
  });

  describe('parseExpiryToSeconds', () => {
    it('parses hours (24h → 86400)', () => {
      expect(parseExpiryToSeconds('24h')).toBe(86400);
    });
    it('parses days (7d → 604800)', () => {
      expect(parseExpiryToSeconds('7d')).toBe(604800);
    });
    it('parses minutes (60m → 3600)', () => {
      expect(parseExpiryToSeconds('60m')).toBe(3600);
    });
    it('parses bare seconds (3600 → 3600)', () => {
      expect(parseExpiryToSeconds('3600')).toBe(3600);
    });
    it('returns default 86400 for unrecognised format', () => {
      expect(parseExpiryToSeconds('invalid')).toBe(86400);
    });
  });

  describe('setAuthCookie / clearAuthCookie', () => {
    function makeMockRes() {
      const cookies: Record<string, { value: string; options: Record<string, unknown> }> = {};
      const cleared: Record<string, Record<string, unknown>> = {};
      return {
        cookie: vi.fn((name: string, value: string, options: Record<string, unknown>) => {
          cookies[name] = { value, options };
        }),
        clearCookie: vi.fn((name: string, options: Record<string, unknown>) => {
          cleared[name] = options;
        }),
        _cookies: cookies,
        _cleared: cleared,
      };
    }

    it('setAuthCookie sets tessera_token as httpOnly and session_expires as non-httpOnly', () => {
      const res = makeMockRes();
      setAuthCookie(res as never, 'my.jwt.token', 86400);

      expect(res.cookie).toHaveBeenCalledTimes(2);

      const tokenCall = res._cookies['tessera_token'];
      expect(tokenCall).toBeDefined();
      expect(tokenCall.value).toBe('my.jwt.token');
      expect(tokenCall.options.httpOnly).toBe(true);
      expect(tokenCall.options.maxAge).toBe(86400 * 1000);

      const expiryCall = res._cookies['session_expires'];
      expect(expiryCall).toBeDefined();
      expect(expiryCall.options.httpOnly).toBe(false);
      expect(expiryCall.options.maxAge).toBe(86400 * 1000);
    });

    it('clearAuthCookie clears both cookies', () => {
      const res = makeMockRes();
      clearAuthCookie(res as never);

      expect(res.clearCookie).toHaveBeenCalledTimes(2);
      expect(res._cleared['tessera_token']).toBeDefined();
      expect(res._cleared['session_expires']).toBeDefined();
    });
  });

  it('returns no active partner when the user only has platform-level access', () => {
    const response = buildAuthResponse({
      token: 'signed-token',
      user: {
        id: 'platform-1',
        name: 'Bob',
        lang: 'en',
        isPlatformOperator: true,
      },
      memberships: [],
    });

    expect(response.memberships).toEqual([]);
    expect(response.activePartnerId).toBeUndefined();
    expect(response.user.isPlatformOperator).toBe(true);
  });
});
