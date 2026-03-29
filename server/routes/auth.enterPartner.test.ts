import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEnterPartnerContextMock = vi.fn();
const insertValuesMock = vi.fn();
const insertMock = vi.fn(() => ({ values: insertValuesMock }));

const authImpl = vi.fn((req: any, _res: any, next: any) => {
  req.user = {
    id: 'platform-1',
    role: 'admin',
    isPlatformOperator: true,
    platformStepUpAt: Math.floor(Date.now() / 1000),
  };
  next();
});

vi.mock('../services/authSession.js', async () => {
  const actual = await vi.importActual<typeof import('../services/authSession.js')>('../services/authSession.js');
  return {
    ...actual,
    getEnterPartnerContext: getEnterPartnerContextMock,
  };
});

vi.mock('../middleware/auth.js', () => ({
  auth: (req: any, res: any, next: any) => authImpl(req, res, next),
}));

vi.mock('../db.js', () => ({
  db: {
    insert: insertMock,
  },
  get: vi.fn(),
  run: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('auth enter-partner route', () => {
  beforeEach(() => {
    getEnterPartnerContextMock.mockReset();
    insertMock.mockClear();
    insertValuesMock.mockReset();
    insertValuesMock.mockResolvedValue(undefined);
    authImpl.mockImplementation((req: any, _res: any, next: any) => {
      req.user = {
        id: 'platform-1',
        role: 'admin',
        isPlatformOperator: true,
        platformStepUpAt: Math.floor(Date.now() / 1000),
      };
      next();
    });
  });

  it('rejects non-platform users', async () => {
    authImpl.mockImplementation((req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        role: 'support',
        isPlatformOperator: false,
      };
      next();
    });

    const { default: authRoutes } = await import('./auth.js');
    const app = express();
    app.use(express.json());
    app.use(authRoutes);

    const res = await request(app).post('/enter-partner').send({ partnerId: 'tenant-a' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Platform operators only' });
    expect(getEnterPartnerContextMock).not.toHaveBeenCalled();
  });

  it('rejects platform users without a recent step-up', async () => {
    authImpl.mockImplementation((req: any, _res: any, next: any) => {
      req.user = {
        id: 'platform-1',
        role: 'admin',
        isPlatformOperator: true,
      };
      next();
    });

    const { default: authRoutes } = await import('./auth.js');
    const app = express();
    app.use(express.json());
    app.use(authRoutes);

    const res = await request(app).post('/enter-partner').send({ partnerId: 'tenant-a' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Platform step-up required' });
  });

  it('returns not found when the tenant does not exist', async () => {
    getEnterPartnerContextMock.mockResolvedValue(undefined);

    const { default: authRoutes } = await import('./auth.js');
    const app = express();
    app.use(express.json());
    app.use(authRoutes);

    const res = await request(app).post('/enter-partner').send({ partnerId: 'tenant-missing' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Partner not found' });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('issues a tenant-scoped platform token for active tenants', async () => {
    getEnterPartnerContextMock.mockResolvedValue({
      id: 'tenant-a',
      name: 'Tenant A',
      status: 'active',
      logoUrl: null,
      industry: 'telecom',
      partnerDepartments: [{ id: 'billing', name: 'Billing' }],
    });

    const { default: authRoutes } = await import('./auth.js');
    const app = express();
    app.use(express.json());
    app.use(authRoutes);

    const res = await request(app).post('/enter-partner').send({ partnerId: 'tenant-a' });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('token');
    expect(res.body.activePartnerId).toBe('tenant-a');
    expect(res.body.manifest).toEqual({
      industry: 'telecom',
      logoUrl: null,
      departments: [{ id: 'billing', name: 'Billing' }],
    });

    // Token should be in Set-Cookie header, not response body
    const cookies = res.headers['set-cookie'];
    const tokenCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((c: string) => c.startsWith('tessera_token='));
    expect(tokenCookie).toBeDefined();
    const cookieToken = tokenCookie!.split(';')[0].split('=').slice(1).join('=');
    const decoded = jwt.verify(cookieToken, 'test-secret-key-only-for-unit-tests-padding-to-reach-sixty-four-c!') as Record<string, unknown>;
    expect(decoded.userId).toBe('platform-1');
    expect(decoded.role).toBe('admin');
    expect(decoded.partnerId).toBe('tenant-a');
    expect(decoded.membershipId).toBe('platform_platform-1_tenant-a');
    expect(decoded.isPlatformOperator).toBe(true);
    expect(typeof decoded.platformStepUpAt).toBe('number');
    expect(insertMock).toHaveBeenCalledTimes(2); // audit log + refresh token
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'platform.enter_partner',
      actorId: 'platform-1',
      partnerId: 'tenant-a',
      targetType: 'partner',
      targetId: 'tenant-a',
      metadata: { entryMode: 'platform_operator' },
    }));
  });
});
