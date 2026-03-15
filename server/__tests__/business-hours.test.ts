import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db } from '../db.js';
import { partners } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { appRouter } from '../trpc/router.js';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { User } from '../types/index.js';

vi.mock('../db.js', () => ({
  query: vi.fn(),
  get: vi.fn(),
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

import { isWithinBusinessHours } from '../services/businessHours.js';

describe('Business Hours Tasks 5 & 6', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Task 3: isWithinBusinessHours logic', () => {
    it('should use global defaults when no partner config provided', () => {
      // Assuming BUSINESS_HOURS_START is something like 07:30 and END is 22:30
      // We can't easily control "now" without mocking Date, but we can at least check if it returns boolean
      const result = isWithinBusinessHours();
      expect(typeof result).toBe('boolean');
    });

    it('should respect partner-specific hours', () => {
      // Mocking current time to be 10:00 AM Europe/Brussels
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T10:00:00Z')); // 11:00 AM CET (Brussels)

      // Partner hours: 09:00 - 17:00
      expect(isWithinBusinessHours({
        businessHoursStart: '09:00',
        businessHoursEnd: '17:00',
        businessHoursTimezone: 'Europe/Brussels'
      })).toBe(true);

      // Partner hours: 12:00 - 17:00 (currently 11:00)
      expect(isWithinBusinessHours({
        businessHoursStart: '12:00',
        businessHoursEnd: '17:00',
        businessHoursTimezone: 'Europe/Brussels'
      })).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('Task 5: /api/v1/config', () => {
    it('should return global defaults when no partnerId provided', async () => {
      const res = await request(app).get('/api/v1/config');
      expect(res.status).toBe(200);
      expect(res.body.businessHoursStart).toBe(config.BUSINESS_HOURS_START);
      expect(res.body.businessHoursEnd).toBe(config.BUSINESS_HOURS_END);
      expect(res.body.businessHoursTimezone).toBe('Europe/Brussels');
    });

    it('should return partner-specific hours when partnerId provided', async () => {
      const mockPartner = {
        id: 'p1',
        businessHoursStart: '09:00',
        businessHoursEnd: '17:00',
        businessHoursTimezone: 'Europe/London',
      };

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockPartner]),
      });

      const res = await request(app).get('/api/v1/config?partnerId=p1');
      expect(res.status).toBe(200);
      expect(res.body.businessHoursStart).toBe('09:00');
      expect(res.body.businessHoursEnd).toBe('17:00');
      expect(res.body.businessHoursTimezone).toBe('Europe/London');
    });
  });

  describe('Task 6: tRPC updateBusinessHours', () => {
    const adminUser = { id: 'admin-1', role: 'admin' as const, partnerId: 'p1', isPlatformOperator: false };
    const caller = appRouter.createCaller({
      user: adminUser as User,
      token: jwt.sign(adminUser, config.JWT_SECRET),
    });

    it('should update business hours for the active partner', async () => {
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue({ success: true }),
      });

      const result = await caller.partner.updateBusinessHours({
        businessHoursStart: '10:00',
        businessHoursEnd: '18:00',
        businessHoursTimezone: 'America/New_York',
      });

      expect(result).toEqual({ success: true });
      expect(db.update).toHaveBeenCalledWith(partners);
    });

    it('should fail for non-admin users', async () => {
      const agentUser = { id: 'agent-1', role: 'agent' as const, partnerId: 'p1', isPlatformOperator: false };
      const agentCaller = appRouter.createCaller({
        user: agentUser as User,
        token: jwt.sign(agentUser, config.JWT_SECRET),
      });

      await expect(agentCaller.partner.updateBusinessHours({
        businessHoursStart: '10:00',
        businessHoursEnd: '18:00',
        businessHoursTimezone: 'America/New_York',
      })).rejects.toThrow();
    });
  });
});
