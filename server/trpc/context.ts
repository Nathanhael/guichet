import { inferAsyncReturnType } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import config from '../config.js';

const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);
import { UserRole } from '../types/index.js';
import { isPlatformAdmin } from '../services/roles.js';
import { isRevoked } from '../services/sessionRevocation.js';

export const jwtPayloadSchema = z.object({
  userId: z.string(),
  role: z.string(),
  partnerId: z.string().optional(),
  membershipId: z.string().optional(),
  departments: z.array(z.string()).optional(),
  isPlatformOperator: z.boolean().optional(),
  jti: z.string().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;

export interface TRPCUser {
  id: string;
  role: UserRole;
  partnerId?: string;
  membershipId?: string;
  departments: string[];
  isPlatformOperator: boolean;
  tokenJti?: string;
  tokenExp?: number;
  tokenIat?: number;
}

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const token: string | undefined = req.cookies?.guichet_token;
  let user: TRPCUser | null = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] });
      const decoded = jwtPayloadSchema.parse(payload);
      const revoked = await isRevoked({ userId: decoded.userId, jti: decoded.jti, iat: decoded.iat });
      if (revoked) {
        return { req, res, user: null };
      }
      user = {
        id: decoded.userId,
        role: decoded.role as UserRole,
        partnerId: decoded.partnerId,
        membershipId: decoded.membershipId,
        departments: decoded.departments ?? [],
        isPlatformOperator: isPlatformAdmin(!!decoded.isPlatformOperator),
        tokenJti: decoded.jti,
        tokenExp: decoded.exp,
        tokenIat: decoded.iat,
      };
    } catch {
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
