import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../../db.js';
import { auditLog, partners, memberships, users } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { AuthRequest } from '../../middleware/auth.js';
import { buildAuthToken, getEnterPartnerContext, listUserMemberships, setAuthCookie, clearAuthCookie, parseExpiryToSeconds } from '../../services/authSession.js';
import { canAccessPartnerContext, isPlatformAdmin } from '../../services/roles.js';
import { revokeToken } from '../../services/sessionRevocation.js';
import { isPlatformStepUpSatisfied } from '../../services/platformStepUp.js';
import { createRefreshToken, rotateRefreshToken, revokeAllUserRefreshTokens } from '../../services/refreshToken.js';
import { refreshRateLimit, setRefreshCookie, clearRefreshCookie } from './rateLimit.js';

export async function registerSessionRoutes(router: express.Router): Promise<void> {

    router.post('/switch-partner', (await import('../../middleware/auth.js')).auth, async (req: AuthRequest, res: Response) => {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const { membershipId } = req.body;
            const userId = req.user.id;

            const results = await db
                .select({
                    id: memberships.id,
                    partnerId: memberships.partnerId,
                    role: memberships.role,
                    departments: memberships.departments,
                    partnerName: partners.name,
                    logoUrl: partners.logoUrl,
                    industry: partners.industry,
                    partnerDepartments: partners.departments,
                    status: partners.status
                })
                .from(memberships)
                .innerJoin(partners, eq(memberships.partnerId, partners.id))
                .where(and(eq(memberships.id, membershipId), eq(memberships.userId, userId)))
                .limit(1);

            const membership = results[0];

            if (!membership) {
                return res.status(403).json({ error: 'Invalid membership for this user' });
            }

            if (membership.status !== 'active') {
                return res.status(403).json({ error: 'Partner is currently inactive' });
            }

            // Re-check platform step-up freshness — don't carry stale step-up across partner switch
            const stepUpStillValid = req.user.isPlatformOperator
                ? isPlatformStepUpSatisfied(req.user.platformStepUpAt)
                : false;

            const token = await buildAuthToken({
                userId,
                role: membership.role,
                departments: (membership.departments as unknown[]) || [],
                partnerId: membership.partnerId,
                membershipId: membership.id,
                isPlatformOperator: req.user.isPlatformOperator,
                platformStepUpAt: stepUpStillValid ? req.user.platformStepUpAt : undefined,
            });

            setAuthCookie(res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));
            await revokeAllUserRefreshTokens(req.user!.id);
            const refreshResult = await createRefreshToken(req.user!.id, membership.partnerId);
            setRefreshCookie(res, refreshResult.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));
            res.json({
                activePartnerId: membership.partnerId,
                manifest: {
                    industry: membership.industry,
                    logoUrl: membership.logoUrl,
                    departments: membership.partnerDepartments || [],
                }
            });
        } catch (err: unknown) {
            logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Switch partner error');
            res.status(500).json({ error: 'Server error during partner switch' });
        }
    });

    router.post('/refresh', refreshRateLimit, async (req: Request, res: Response) => {
        try {
            const refreshTokenCookie = req.cookies?.tessera_refresh;
            if (!refreshTokenCookie) {
                return res.status(401).json({ error: 'No refresh token' });
            }

            const result = await rotateRefreshToken(refreshTokenCookie);
            if (!result) {
                clearAuthCookie(res);
                clearRefreshCookie(res);
                return res.status(401).json({ error: 'Invalid or expired refresh token' });
            }

            // Get user and build fresh access token
            const userRows = await db.select().from(users).where(eq(users.id, result.userId)).limit(1);
            const refreshUser = userRows[0];
            if (!refreshUser) {
                clearAuthCookie(res);
                clearRefreshCookie(res);
                return res.status(401).json({ error: 'User not found' });
            }

            const userMemberships = await listUserMemberships(result.userId);
            const activeMemberships = userMemberships.filter(m => m.status === 'active');

            // Prefer the partner stored in the refresh token (preserves context across rotation).
            // Fall back to first active membership only if the stored partner is no longer active.
            const preferredMembership = result.partnerId
                ? activeMemberships.find(m => m.partnerId === result.partnerId)
                : null;
            const membership = preferredMembership || activeMemberships[0];

            // Platform operators without partner memberships can still operate
            if (!membership && refreshUser.isPlatformOperator) {
                const token = await buildAuthToken({
                    userId: refreshUser.id,
                    role: 'platform_operator',
                    departments: [],
                    partnerId: undefined,
                    membershipId: undefined,
                    isPlatformOperator: true,
                });
                const accessExpiry = parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY);
                setAuthCookie(res, token, accessExpiry);
                setRefreshCookie(res, result.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));
                return res.json({ expiresIn: accessExpiry });
            }

            if (!membership) {
                await revokeAllUserRefreshTokens(result.userId);
                clearAuthCookie(res);
                clearRefreshCookie(res);
                return res.status(401).json({ error: 'No active memberships' });
            }

            const token = await buildAuthToken({
                userId: refreshUser.id,
                role: membership.role,
                departments: (membership.departments as unknown[]) || [],
                partnerId: membership.partnerId,
                membershipId: membership.id,
                isPlatformOperator: !!refreshUser.isPlatformOperator,
            });

            const accessExpiry = parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY);
            setAuthCookie(res, token, accessExpiry);
            setRefreshCookie(res, result.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));

            res.json({ expiresIn: accessExpiry });
        } catch (err: unknown) {
            logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Refresh token error');
            res.status(500).json({ error: 'Server error during token refresh' });
        }
    });

    router.post('/logout', (await import('../../middleware/auth.js')).auth, async (req: AuthRequest, res: Response) => {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            let revocationFailed = false;
            if (req.user.tokenJti) {
                const revoked = await revokeToken(req.user.tokenJti, req.user.tokenExp);
                if (!revoked) {
                    logger.error({ jti: req.user.tokenJti }, '[Auth] SECURITY: Token revocation failed at logout — token may remain valid until expiry');
                    revocationFailed = true;
                }
            }
            await revokeAllUserRefreshTokens(req.user.id);
            clearAuthCookie(res);
            clearRefreshCookie(res);
            res.json({ success: true, ...(revocationFailed && { revocationFailed: true }) });
        } catch (err: unknown) {
            logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Logout FATAL error');
            res.status(500).json({ error: 'Server error during logout' });
        }
    });

    router.post('/enter-partner', (await import('../../middleware/auth.js')).auth, async (req: AuthRequest, res: Response) => {
        try {
            if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
            const { partnerId } = req.body;
            const userId = req.user.id;

            if (!isPlatformAdmin(req.user.isPlatformOperator)) {
                return res.status(403).json({ error: 'Platform operators only' });
            }

            if (!isPlatformStepUpSatisfied(req.user.platformStepUpAt)) {
                return res.status(403).json({ error: 'Platform step-up required' });
            }

            if (!partnerId) {
                return res.status(400).json({ error: 'partnerId is required' });
            }

            const partner = await getEnterPartnerContext(partnerId);

            if (!partner) {
                return res.status(404).json({ error: 'Partner not found' });
            }

            if (partner.status !== 'active') {
                return res.status(403).json({ error: 'Partner is currently inactive' });
            }

            if (!canAccessPartnerContext(true, partner.id)) {
                return res.status(403).json({ error: 'Partner access denied' });
            }

            const token = await buildAuthToken({
                userId,
                role: 'admin',
                departments: [],
                partnerId: partner.id,
                membershipId: `platform_${userId}_${partner.id}`,
                isPlatformOperator: true,
                platformStepUpAt: req.user.platformStepUpAt,
            });

            logger.info({ userId, partnerId: partner.id }, '[Auth] Platform operator entered partner');

            await db.insert(auditLog).values({
                id: crypto.randomUUID(),
                action: 'platform.enter_partner',
                actorId: userId,
                partnerId: partner.id,
                targetType: 'partner',
                targetId: partner.id,
                metadata: {
                    entryMode: 'platform_operator',
                }
            });

            setAuthCookie(res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));
            await revokeAllUserRefreshTokens(userId);
            const refreshResult = await createRefreshToken(userId, partner.id);
            setRefreshCookie(res, refreshResult.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));
            res.json({
                activePartnerId: partner.id,
                partnerName: partner.name,
                manifest: {
                    industry: partner.industry,
                    logoUrl: partner.logoUrl,
                    departments: partner.partnerDepartments || [],
                }
            });
        } catch (err: unknown) {
            logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Enter partner FATAL error');
            res.status(500).json({ error: 'Server error during partner entry' });
        }
    });

}
