/**
 * Session boundary suite for the new services/auth module.
 *
 * Asserts the token-mint → JWT-shape lifecycle, without HTTP machinery.
 * Refresh-token rotation and revocation cascade need DB-injection seams
 * that don't exist yet (refreshToken.ts imports `db` at module level);
 * they're covered by route-level tests today.
 */
import { describe, it, expect } from 'vitest';
import { jwtVerify } from 'jose';

import { buildAuthToken } from './authSession.js';
import { jwtPayloadSchema } from '../../trpc/context.js';
import config from '../../config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);

describe('session boundary — login → JWT', () => {
  it('JWT round-trip preserves all identity claims used by the actor builder', async () => {
    const token = await buildAuthToken({
      userId: 'u-roundtrip',
      role: 'support',
      partnerId: 'p-roundtrip',
      membershipId: 'm-roundtrip',
      departments: ['sales', 'billing'],
      isPlatformOperator: false,
    });

    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);

    expect(parsed.userId).toBe('u-roundtrip');
    expect(parsed.role).toBe('support');
    expect(parsed.partnerId).toBe('p-roundtrip');
    expect(parsed.membershipId).toBe('m-roundtrip');
    expect(parsed.departments).toEqual(['sales', 'billing']);
    expect(parsed.isPlatformOperator).toBe(false);
  });
});
