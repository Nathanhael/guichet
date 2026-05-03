// server/middleware/uploadProxy.test.ts
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let jwtPayload: Record<string, unknown> = {
  userId: 'u1',
  role: 'support',
  partnerId: 'partner-acme',
  isPlatformOperator: false,
};
let jwtThrows = false;

vi.mock('jose', () => ({
  jwtVerify: vi.fn(async () => {
    if (jwtThrows) throw new Error('bad signature');
    return { payload: jwtPayload };
  }),
}));

let lookupResult: string | null = 'partner-acme';
const lookupMock = vi.fn(async () => lookupResult);
vi.mock('../services/uploadOwnership.js', () => ({
  lookupFilePartnerId: lookupMock,
}));

const storageReadMock = vi.fn(async (_filename: string) => Buffer.from('content'));
vi.mock('../services/storage.js', () => ({
  getStorage: () => ({
    read: storageReadMock,
    upload: vi.fn(),
    delete: vi.fn(),
    getUrl: vi.fn(),
    healthy: vi.fn(),
  }),
}));

vi.mock('../config.js', () => ({
  default: { JWT_SECRET: 'test-secret' },
}));

async function buildApp() {
  const { uploadProxyHandler } = await import('./uploadProxy.js');
  const app = express();
  app.use(cookieParser());
  app.use('/uploads', uploadProxyHandler);
  return app;
}

describe('uploadProxyHandler tenant gate', () => {
  beforeEach(() => {
    jwtThrows = false;
    jwtPayload = {
      userId: 'u1',
      role: 'support',
      partnerId: 'partner-acme',
      isPlatformOperator: false,
    };
    lookupResult = 'partner-acme';
    vi.clearAllMocks();
    storageReadMock.mockResolvedValue(Buffer.from('content'));
  });

  it('200s and serves the buffer when filename owner matches caller partner', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/uploads/abc.png')
      .set('Cookie', 'guichet_token=valid');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(storageReadMock).toHaveBeenCalledWith('abc.png');
    expect(lookupMock).toHaveBeenCalledWith('abc.png');
  });

  it('403s when filename belongs to a different partner (cross-tenant attempt)', async () => {
    lookupResult = 'partner-other';
    const app = await buildApp();
    const res = await request(app)
      .get('/uploads/abc.png')
      .set('Cookie', 'guichet_token=valid');
    expect(res.status).toBe(403);
    expect(storageReadMock).not.toHaveBeenCalled();
  });

  it('404s when filename is not registered in any message', async () => {
    lookupResult = null;
    const app = await buildApp();
    const res = await request(app)
      .get('/uploads/missing.png')
      .set('Cookie', 'guichet_token=valid');
    expect(res.status).toBe(404);
    expect(storageReadMock).not.toHaveBeenCalled();
  });

  it('401s when JWT cookie is absent', async () => {
    const app = await buildApp();
    const res = await request(app).get('/uploads/abc.png');
    expect(res.status).toBe(401);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('401s when JWT verification fails', async () => {
    jwtThrows = true;
    const app = await buildApp();
    const res = await request(app)
      .get('/uploads/abc.png')
      .set('Cookie', 'guichet_token=tampered');
    expect(res.status).toBe(401);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('403s when caller has no partnerId in JWT (platform operator pre-/enter-partner)', async () => {
    jwtPayload = { userId: 'op1', role: 'platform_operator', isPlatformOperator: true };
    lookupResult = 'partner-acme';
    const app = await buildApp();
    const res = await request(app)
      .get('/uploads/abc.png')
      .set('Cookie', 'guichet_token=valid');
    expect(res.status).toBe(403);
  });

  it('400s on path traversal attempts', async () => {
    const app = await buildApp();
    const res = await request(app)
      .get('/uploads/%2E%2E/etc/passwd')
      .set('Cookie', 'guichet_token=valid');
    expect([400, 404]).toContain(res.status); // Express normalizes %2E differently
  });
});
