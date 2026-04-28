import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

const isRevokedMock = vi.fn();

vi.mock('../config.js', () => ({
  default: {
    JWT_SECRET: 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!',
  },
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/auth/index.js', () => ({
  isRevoked: isRevokedMock,
}));

vi.mock('../services/roles.js', () => ({
  isPlatformAdmin: (v: boolean) => v,
  canManageTenant: (role: string, isPlatformOp: boolean) => role === 'admin' || isPlatformOp,
  canUseSupportWorkflows: (role: string, isPlatformOp: boolean) => role === 'support' || role === 'admin' || isPlatformOp,
}));

const SECRET = 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!';
const secretBytes = new TextEncoder().encode(SECRET);

async function makeToken(payload: Record<string, unknown>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes);
}

function mockReqRes(cookie?: string) {
  const req: any = {
    headers: {},
    cookies: cookie ? { guichet_token: cookie } : {},
    user: undefined,
  };
  const res: any = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('auth middleware', () => {
  beforeEach(() => {
    isRevokedMock.mockReset();
    isRevokedMock.mockResolvedValue(false);
  });

  it('returns 401 when no cookie is provided', async () => {
    const { auth } = await import('./auth.js');
    const { req, res, next } = mockReqRes(undefined);
    await auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid/expired JWT', async () => {
    const { auth } = await import('./auth.js');
    const { req, res, next } = mockReqRes('invalid.token.here');
    await auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when session is revoked', async () => {
    isRevokedMock.mockResolvedValue(true);

    const { auth } = await import('./auth.js');
    const token = await makeToken({ userId: 'u1', role: 'support', isPlatformOperator: false });
    const { req, res, next } = mockReqRes(token);
    await auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session revoked' });
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches user to req and calls next() for a valid token', async () => {
    const { auth } = await import('./auth.js');
    const token = await makeToken({ userId: 'u1', role: 'support', isPlatformOperator: false });
    const { req, res, next } = mockReqRes(token);
    await auth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(expect.objectContaining({
      id: 'u1',
      role: 'support',
      isPlatformOperator: false,
    }));
  });

  it('sets isPlatformOperator from token claim', async () => {
    const { auth } = await import('./auth.js');
    const token = await makeToken({ userId: 'u1', role: 'admin', isPlatformOperator: true });
    const { req, res, next } = mockReqRes(token);
    await auth(req, res, next);

    expect(req.user.isPlatformOperator).toBe(true);
  });
});

describe('authorize middleware', () => {
  it('returns 401 when req.user is missing', async () => {
    const { authorize } = await import('./auth.js');
    const middleware = authorize(['admin']);
    const { req, res, next } = mockReqRes();
    req.user = undefined;
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user role is not in allowed list', async () => {
    const { authorize } = await import('./auth.js');
    const middleware = authorize(['admin']);
    const { req, res, next } = mockReqRes();
    req.user = { id: 'u1', role: 'agent', isPlatformOperator: false };
    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows access when user role matches', async () => {
    const { authorize } = await import('./auth.js');
    const middleware = authorize(['support']);
    const { req, res, next } = mockReqRes();
    req.user = { id: 'u1', role: 'support', isPlatformOperator: false };
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('allows platform operator to access admin routes via canManageTenant', async () => {
    const { authorize } = await import('./auth.js');
    const middleware = authorize(['admin']);
    const { req, res, next } = mockReqRes();
    req.user = { id: 'u1', role: 'support', isPlatformOperator: true };
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('allows platform operator to access support routes via canUseSupportWorkflows', async () => {
    const { authorize } = await import('./auth.js');
    const middleware = authorize(['support']);
    const { req, res, next } = mockReqRes();
    req.user = { id: 'u1', role: 'agent', isPlatformOperator: true };
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
