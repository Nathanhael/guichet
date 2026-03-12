import jwt from 'jsonwebtoken';
import config from '../config.js';
import { Request, Response, NextFunction } from 'express';
import { User, UserRole } from '../types/index.js';

export type AuthRequest<
  P = any,
  ResBody = any,
  ReqBody = any,
  ReqQuery = any
> = Request<P, ResBody, ReqBody, ReqQuery> & {
  user?: {
    id: string;
    role: UserRole;
  };
};

export const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as { userId: string; role: UserRole };
    req.user = { id: decoded.userId, role: decoded.role };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};
