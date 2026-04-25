import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const limitMock = vi.fn();
const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
const fromMock = vi.fn().mockReturnValue({ where: whereMock });
const selectMock = vi.fn().mockReturnValue({ from: fromMock });

vi.mock('../db/postgres.js', () => ({
  db: { select: selectMock },
}));

vi.mock('../db/schema.js', () => ({
  tickets: {
    status: 'status',
    partnerId: 'partnerId',
    dept: 'dept',
    agentName: 'agentName',
    supportName: 'supportName',
    createdAt: 'createdAt',
    closedAt: 'closedAt',
  },
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../services/roles.js', () => ({
  canExportTickets: (role: string, _isPlatformOperator: boolean) =>
    ['admin', 'support'].includes(role),
}));

vi.mock('../utils/security.js', () => ({
  escapeLikePattern: (s: string) => s,
}));

vi.mock('../middleware/validator.js', () => ({
  validateQuery: () => (_req: any, _res: any, next: any) => next(),
}));

let mockPartnerId: string | undefined;

vi.mock('../middleware/auth.js', () => ({
  auth: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'user-1',
      role: 'support',
      isPlatformOperator: false,
      partnerId: mockPartnerId,
    };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

describe('tickets export route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderByMock.mockReturnValue({ limit: limitMock });
    whereMock.mockReturnValue({ orderBy: orderByMock });
    fromMock.mockReturnValue({ where: whereMock });
    selectMock.mockReturnValue({ from: fromMock });
  });

  it('rejects export without tenant context for non-platform users', async () => {
    mockPartnerId = undefined;
    const { default: ticketRoutes } = await import('./tickets.js');
    const app = express();
    app.use(ticketRoutes);

    const res = await request(app).get('/export');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'partnerId is required' });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('scopes export queries by partner id', async () => {
    mockPartnerId = 'tenant-a';
    limitMock.mockResolvedValue([
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
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(res.text).toContain('ticket-1');
  });
});
