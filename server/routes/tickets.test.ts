import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../db.js', () => ({
  query: queryMock,
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../middleware/auth.js', () => ({
  auth: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'user-1',
      role: 'support',
      isPlatformOperator: false,
    };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

describe('tickets export route', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('rejects export without tenant context for non-platform users', async () => {
    const { default: ticketRoutes } = await import('./tickets.js');
    const app = express();
    app.use(ticketRoutes);

    const res = await request(app).get('/export');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'partnerId is required' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('scopes export queries by partner id', async () => {
    queryMock.mockResolvedValue([
      {
        id: 'ticket-1',
        dept: 'billing',
        agentName: 'Alice',
        supportName: 'Erik',
        createdAt: '2026-03-23T10:00:00.000Z',
        closedAt: '2026-03-23T11:00:00.000Z',
        status: 'closed',
        references: [],
      },
    ]);

    const { default: ticketRoutes } = await import('./tickets.js');
    const app = express();
    app.use(ticketRoutes);

    const res = await request(app).get('/export').query({ partnerId: 'tenant-a' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(queryMock).toHaveBeenCalledTimes(1);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("partner_id = $1");
    expect(params).toEqual(['tenant-a']);
    expect(res.text).toContain('ticket-1');
  });
});
