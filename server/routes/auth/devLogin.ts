import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { validateBody } from '../../middleware/validator.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import {
  buildAuthResponse,
  buildAuthToken,
  listUserMemberships,
  setAuthCookie,
  parseExpiryToSeconds,
} from '../../services/authSession.js';
import { createRefreshToken } from '../../services/refreshToken.js';
import { setRefreshCookie } from './rateLimit.js';

/**
 * Dev-only "mint JWT directly" endpoint used by the DemoUserPicker and the
 * Playwright loginAsDemo helper. Bypasses password/MFA/lockout so the rest of
 * the local-auth subsystem can be removed once real demos stop relying on it.
 *
 * Blocked outright in production via a 404 — the route is still mounted so a
 * misconfigured prod deploy gets an unambiguous response instead of a 500.
 */
export function registerDevLoginRoutes(router: express.Router): void {
  router.post(
    '/dev-login',
    validateBody(z.object({ userId: z.string().min(1) })),
    async (req: Request, res: Response) => {
      if (config.NODE_ENV === 'production') {
        return res.status(404).end();
      }

      try {
        const { userId } = req.body;

        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        const userMemberships = await listUserMemberships(user.id);
        const activeMemberships = userMemberships.filter((m) => m.status === 'active');
        const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

        const token = await buildAuthToken({
          userId: user.id,
          role: defaultMembership?.role || 'agent',
          departments: (defaultMembership?.departments as unknown[]) || [],
          partnerId: defaultMembership?.partnerId,
          membershipId: defaultMembership?.id,
          isPlatformOperator: !!user.isPlatformOperator,
        });

        await db
          .update(users)
          .set({ lastActiveAt: new Date().toISOString() })
          .where(eq(users.id, user.id));

        setAuthCookie(res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));
        const refreshResult = await createRefreshToken(user.id, defaultMembership?.partnerId);
        setRefreshCookie(res, refreshResult.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));

        logger.info(
          { userId, partnerId: defaultMembership?.partnerId },
          '[Auth] Dev login',
        );

        res.json(
          buildAuthResponse({
            user: {
              id: user.id,
              name: user.name,
              email: user.email ?? '',
              lang: user.lang,
              isPlatformOperator: user.isPlatformOperator,
              isExternal: user.isExternal,
              accessibilityPrefs: user.accessibilityPrefs ?? {},
            },
            memberships: userMemberships,
          }),
        );
      } catch (err: unknown) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          '[Auth] Dev login error',
        );
        res.status(500).json({ error: 'Server error' });
      }
    },
  );
}
