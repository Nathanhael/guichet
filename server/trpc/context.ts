import { inferAsyncReturnType } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { UserRole } from '../types/index.js';
import { isPlatformAdmin } from '../services/roles.js';
import { isRevoked } from '../services/sessionRevocation.js';

export interface JwtPayload {
  userId: string;
  role: UserRole;
  partnerId?: string;
  membershipId?: string;
  isPlatformOperator?: boolean;
  platformStepUpAt?: number;
  jti?: string;
  iat?: number;
  exp?: number;
}

export interface TRPCUser {
  id: string;
  role: UserRole;
  partnerId?: string;
  membershipId?: string;
  isPlatformOperator: boolean;
  platformStepUpAt?: number;
  tokenJti?: string;
  tokenExp?: number;
  tokenIat?: number;
}

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const token = req.headers.authorization?.split(' ')[1];
  let user: TRPCUser | null = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
      const revoked = await isRevoked({ userId: decoded.userId, jti: decoded.jti, iat: decoded.iat });
      if (revoked) {
        return { req, res, user: null };
      }
      user = {
        id: decoded.userId,
        role: decoded.role,
        partnerId: decoded.partnerId,
        membershipId: decoded.membershipId,
        isPlatformOperator: isPlatformAdmin(!!decoded.isPlatformOperator),
        platformStepUpAt: decoded.platformStepUpAt,
        tokenJti: decoded.jti,
        tokenExp: decoded.exp,
        tokenIat: decoded.iat,
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
