import { inferAsyncReturnType } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { UserRole } from '../types/index.js';

export interface JwtPayload {
  userId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface TRPCUser {
  id: string;
  role: UserRole;
}

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const token = req.headers.authorization?.split(' ')[1];
  let user: TRPCUser | null = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
      user = {
        id: decoded.userId,
        role: decoded.role,
      };
    } catch (err) {
      // Ignore invalid tokens for base context
    }
  }

  return {
    req,
    res,
    user,
  };
}

export type Context = inferAsyncReturnType<typeof createContext>;
