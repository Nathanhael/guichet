/**
 * Session boundary suite for the new services/auth module.
 *
 * Asserts the token-mint → JWT-shape → actor-narrowing → capability-gate
 * lifecycle, without HTTP machinery. Refresh-token rotation and revocation
 * cascade need DB-injection seams that don't exist yet (refreshToken.ts
 * imports `db` at module level); they're covered by route-level tests today
 * and become the focus of slice #67's flip-revocation cascade test.
 */
import { describe, it, expect } from 'vitest';
import { jwtVerify } from 'jose';

import { buildAuthToken } from './authSession.js';
import { jwtPayloadSchema } from '../../trpc/context.js';
import config from '../../config.js';
import { actorFactory } from './actor.js';
import { can } from './capabilities.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);

describe('session boundary — login → JWT → actor', () => {
  it('mints a token whose payload exposes isExternal=false for a non-guest user', async () => {
    const token = await buildAuthToken({
      userId: 'u-internal',
      role: 'admin',
      partnerId: 'p-1',
      membershipId: 'm-1',
      departments: [],
      isPlatformOperator: false,
      isExternal: false,
    });

    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);

    expect(parsed.userId).toBe('u-internal');
    expect(parsed.isExternal).toBe(false);
  });

  it('mints a token with isExternal=true for a B2B guest', async () => {
    const token = await buildAuthToken({
      userId: 'u-guest',
      role: 'admin',
      partnerId: 'p-1',
      membershipId: 'm-1',
      departments: [],
      isPlatformOperator: false,
      isExternal: true,
    });

    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);

    expect(parsed.isExternal).toBe(true);
  });

  it('actor built from a non-guest internal user can perform destructive_admin', () => {
    const internal = actorFactory({
      userId: 'u-internal',
      role: 'admin',
      isPlatformOperator: false,
      isExternal: false,
      partnerId: 'p-1',
    });

    expect(can(internal, 'destructive_admin')).toBe(true);
    expect(can(internal, 'manage_tenant')).toBe(true);
  });

  it('actor built from a B2B guest is blocked from destructive_admin while still able to read', () => {
    const guest = actorFactory({
      userId: 'u-guest',
      role: 'admin',
      isPlatformOperator: false,
      isExternal: true,
      partnerId: 'p-1',
    });

    expect(can(guest, 'destructive_admin')).toBe(false);
    // Read-flavored capabilities remain available to guests with admin role.
    expect(can(guest, 'manage_tenant')).toBe(true);
    expect(can(guest, 'tenant_admin')).toBe(true);
  });

  it('platform operators retain destructive_admin only when not flagged isExternal', () => {
    const platformInternal = actorFactory({
      userId: 'u-platform',
      role: 'platform_operator',
      isPlatformOperator: true,
      isExternal: false,
      partnerId: 'p-1',
    });
    const platformGuest = actorFactory({
      userId: 'u-platform-guest',
      role: 'platform_operator',
      isPlatformOperator: true,
      isExternal: true,
      partnerId: 'p-1',
    });

    expect(can(platformInternal, 'destructive_admin')).toBe(true);
    expect(can(platformGuest, 'destructive_admin')).toBe(false);
  });

  it('JWT round-trip preserves all identity claims used by the actor builder', async () => {
    const token = await buildAuthToken({
      userId: 'u-roundtrip',
      role: 'support',
      partnerId: 'p-roundtrip',
      membershipId: 'm-roundtrip',
      departments: ['sales', 'billing'],
      isPlatformOperator: false,
      isExternal: false,
    });

    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);

    expect(parsed.userId).toBe('u-roundtrip');
    expect(parsed.role).toBe('support');
    expect(parsed.partnerId).toBe('p-roundtrip');
    expect(parsed.membershipId).toBe('m-roundtrip');
    expect(parsed.departments).toEqual(['sales', 'billing']);
    expect(parsed.isPlatformOperator).toBe(false);
    expect(parsed.isExternal).toBe(false);
  });
});
