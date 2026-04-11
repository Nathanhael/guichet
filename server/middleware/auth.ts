import { jwtVerify } from 'jose';
import config from '../config.js';

const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);
import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types/index.js';
import { jwtPayloadSchema } from '../trpc/context.js';
import logger from '../utils/logger.js';
import { canManageTenant, canUseSupportWorkflows, isPlatformAdmin } from '../services/roles.js';
import { isRevoked } from '../services/sessionRevocation.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: UserRole;
    partnerId?: string;
    membershipId?: string;
    departments?: unknown[];
    isPlatformOperator: boolean;
    platformStepUpAt?: number;
    tokenJti?: string;
    tokenExp?: number;
    tokenIat?: number;
  };
}

export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token: string | undefined = req.cookies?.tessera_token;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] });
    const decoded = jwtPayloadSchema.parse(payload);
    const revoked = await isRevoked({ userId: decoded.userId, jti: decoded.jti, iat: decoded.iat });
    if (revoked) {
      return res.status(401).json({ error: 'Session revoked' });
    }

    req.user = {
      id: decoded.userId,
      role: decoded.role as UserRole,
      partnerId: decoded.partnerId,
      membershipId: decoded.membershipId,
      departments: decoded.departments,
      isPlatformOperator: isPlatformAdmin(!!decoded.isPlatformOperator),
      platformStepUpAt: decoded.platformStepUpAt,
      tokenJti: decoded.jti,
      tokenExp: decoded.exp,
      tokenIat: decoded.iat,
    };
    next();
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'JWT verification failed');
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const allowed =
      roles.includes(req.user.role) ||
      (roles.includes('admin') && canManageTenant(req.user.role, req.user.isPlatformOperator)) ||
      (roles.includes('support') && canUseSupportWorkflows(req.user.role, req.user.isPlatformOperator));

    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
};
