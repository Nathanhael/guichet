import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildAuthResponse, buildAuthToken } from './authSession.js';

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
