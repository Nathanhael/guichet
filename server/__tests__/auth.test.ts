import { describe, it, expect, vi } from 'vitest';
import { auth, authorize, AuthRequest } from '../middleware/auth.js';
import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config.js';

// Helper to create mock req/res/next
function mockReqResNext(overrides: Partial<AuthRequest> = {}) {
  const req = {
    headers: {},
    query: {},
    ...overrides,
  } as unknown as AuthRequest;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('Auth Middleware', () => {
  describe('auth', () => {
    it('should return 401 when no token provided', () => {
      const { req, res, next } = mockReqResNext();
      auth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should authenticate with valid Bearer token', () => {
      const token = jwt.sign({ userId: 'user1', role: 'agent' }, config.JWT_SECRET);
      const { req, res, next } = mockReqResNext({
        headers: { authorization: `Bearer ${token}` },
      });
      auth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.id).toBe('user1');
      expect(req.user.role).toBe('agent');
    });

    it('should return 401 with invalid token', () => {
      const { req, res, next } = mockReqResNext({
        headers: { authorization: 'Bearer invalid-token' },
      });
      auth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should authenticate with query token', () => {
      const token = jwt.sign({ userId: 'user2', role: 'expert' }, config.JWT_SECRET);
      const { req, res, next } = mockReqResNext({
        query: { token },
      });
      auth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user.id).toBe('user2');
    });
  });

  describe('authorize', () => {
    it('should allow authorized roles', () => {
      const { req, res, next } = mockReqResNext();
      req.user = { id: 'user1', role: 'admin' };
      authorize(['admin'])(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('should deny unauthorized roles', () => {
      const { req, res, next } = mockReqResNext();
      req.user = { id: 'user1', role: 'agent' };
      authorize(['admin'])(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should deny when no user on request', () => {
      const { req, res, next } = mockReqResNext();
      authorize(['admin'])(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
