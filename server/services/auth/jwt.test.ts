import { describe, it, expect } from 'vitest';
import { jwtVerify, SignJWT } from 'jose';
import { jwtPayloadSchema } from '../../trpc/context.js';

const secret = new TextEncoder().encode(
  'test-secret-padding-padding-padding-padding-padding-padding-pad-64'
);

async function mintToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti('jti-test')
    .sign(secret);
}

describe('JWT payload schema — isExternal claim', () => {
  it('parses tokens that contain isExternal=true', async () => {
    const token = await mintToken({
      userId: 'u-1',
      role: 'admin',
      partnerId: 'p-1',
      isPlatformOperator: false,
      isExternal: true,
    });
    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);
    expect(parsed.isExternal).toBe(true);
  });

  it('parses tokens that contain isExternal=false', async () => {
    const token = await mintToken({
      userId: 'u-1',
      role: 'admin',
      partnerId: 'p-1',
      isPlatformOperator: false,
      isExternal: false,
    });
    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);
    expect(parsed.isExternal).toBe(false);
  });

  it('parses legacy tokens (missing isExternal claim) without throwing', async () => {
    const token = await mintToken({
      userId: 'u-1',
      role: 'admin',
      partnerId: 'p-1',
      isPlatformOperator: false,
    });
    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);
    expect(parsed.isExternal).toBeUndefined();
  });
});
