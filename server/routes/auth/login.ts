import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { validateBody } from '../../middleware/validator.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { verifyPassword } from '../../utils/passwords.js';
import { checkLockout, recordFailedLogin, resetFailedLogins } from '../../services/accountLockout.js';
import { buildAuthResponse, buildAuthToken, findUserByEmail, listUserMemberships, setAuthCookie, parseExpiryToSeconds } from '../../services/authSession.js';
import { isPlatformAdmin } from '../../services/roles.js';
import { createRefreshToken } from '../../services/refreshToken.js';
import { loginRateLimit, setRefreshCookie, maskEmail, findRecoveryCodeIndex, DUMMY_ARGON2_HASH } from './rateLimit.js';

export function registerLoginRoutes(router: express.Router): void {

router.post('/login-local', loginRateLimit, validateBody(z.object({
    email: z.string().email('Valid email is required'),
    password: z.string().min(1, 'Password is required'),
}).passthrough()), async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        logger.info({ email: maskEmail(email) }, '[Auth] Local login attempt started');

        const user = await findUserByEmail(email);

        if (!user || !user.password) {
            // Constant-time: always run Argon2 to prevent timing-based user enumeration
            await verifyPassword(DUMMY_ARGON2_HASH, password);
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login failed: User not found or no password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Local login is only available for platform operators
        if (!user.isPlatformOperator) {
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login rejected: non-platform user must use SSO');
            return res.status(403).json({ error: 'Local login is not available. Please use SSO to sign in.' });
        }

        // Account lockout check
        const lockout = checkLockout(user);
        if (lockout.locked) {
            const retryMins = Math.ceil((lockout.retryAfterMs || 0) / 60000);
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login blocked: account locked');
            return res.status(423).json({ error: `Account locked. Try again in ${retryMins} minute(s).` });
        }

        const isMatch = await verifyPassword(user.password, password);

        if (!isMatch) {
            const result = await recordFailedLogin(user.id, !!user.isPlatformOperator);
            logger.warn({ email: maskEmail(email), attemptsLeft: result.attemptsLeft }, '[Auth] Local login failed: Password mismatch');
            if (result.locked) {
                return res.status(423).json({ error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // ME-02 fix: Re-check lockout with a FRESH database fetch instead of stale in-memory object.
        // The original code used `checkLockout(user)` on the stale request-start snapshot, which
        // could never detect a concurrent lock. Now we re-fetch the user row to catch the edge case
        // where a different concurrent request locked the account between our initial check and
        // password verification. The atomic SQL in recordFailedLogin is the primary protection;
        // this is a genuine belt-and-suspenders guard.
        const [freshUser] = await db.select({ lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, user.id)).limit(1);
        if (freshUser) {
            const lockoutAfterPw = checkLockout({ lockedUntil: freshUser.lockedUntil });
            if (lockoutAfterPw.locked) {
                const retryMins = Math.ceil((lockoutAfterPw.retryAfterMs || 0) / 60000);
                return res.status(423).json({ error: `Account locked. Try again in ${retryMins} minute(s).` });
            }
        }

        const userMemberships = await listUserMemberships(user.id);

        logger.info({ email: maskEmail(email), membershipCount: userMemberships.length }, '[Auth] Local login membership lookup complete');

        if (userMemberships.length === 0 && !isPlatformAdmin(!!user.isPlatformOperator)) {
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login failed: No memberships found');
            return res.status(403).json({ error: 'User has no memberships' });
        }

        // Check if MFA is enabled
        if (user.mfaEnabledAt) {
            const { totpCode } = req.body;
            if (!totpCode) {
                // Return MFA challenge — client must re-submit with email+password+totpCode
                return res.status(401).json({ mfaRequired: true });
            }
            // Verify TOTP code (import inline to avoid circular deps)
            const { verifyTotpToken, isTotpTokenUsed, markTotpTokenUsed } = await import('../../services/platformStepUp.js');
            const totpAlreadyUsed = await isTotpTokenUsed(user.id, totpCode);
            if (!user.mfaSecret || totpAlreadyUsed || !verifyTotpToken(user.mfaSecret, totpCode)) {
                // Check recovery codes
                const recoveryCodes = (user.mfaRecoveryCodes as string[]) || [];
                const codeHash = crypto.createHash('sha256').update(totpCode).digest('hex');
                const recoveryIdx = findRecoveryCodeIndex(recoveryCodes, codeHash);
                if (recoveryIdx === -1) {
                    const mfaFailResult = await recordFailedLogin(user.id, !!user.isPlatformOperator);
                    logger.warn({ email: maskEmail(email), attemptsLeft: mfaFailResult.attemptsLeft }, '[Auth] Local login failed: Invalid MFA code');
                    if (mfaFailResult.locked) {
                        return res.status(423).json({ error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
                    }
                    return res.status(401).json({ error: 'Invalid MFA code' });
                }
                // Consume the recovery code
                const updatedCodes = [...recoveryCodes];
                updatedCodes.splice(recoveryIdx, 1);
                await db.update(users).set({ mfaRecoveryCodes: updatedCodes }).where(eq(users.id, user.id));
                logger.info({ userId: user.id }, '[Auth] MFA passed via recovery code');
            } else {
                await markTotpTokenUsed(user.id, totpCode);
            }
        }

        // Fully authenticated — reset lockout counter (after MFA if applicable)
        await resetFailedLogins(user.id);

        const activeMemberships = userMemberships.filter(m => m.status === 'active');
        const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

        const token = await buildAuthToken({
            userId: user.id,
            role: defaultMembership?.role || 'agent',
            departments: (defaultMembership?.departments as unknown[]) || [],
            partnerId: defaultMembership?.partnerId,
            membershipId: defaultMembership?.id,
            isPlatformOperator: !!user.isPlatformOperator,
            platformStepUpAt: undefined,
        });

        logger.info({ email: maskEmail(email), partnerId: defaultMembership?.partnerId }, '[Auth] Local login successful');

        // Update lastActiveAt
        await db.update(users).set({ lastActiveAt: new Date().toISOString() }).where(eq(users.id, user.id));

        setAuthCookie(res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));
        const refreshResult = await createRefreshToken(user.id, defaultMembership?.partnerId);
        setRefreshCookie(res, refreshResult.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));
        res.json(buildAuthResponse({
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
        }));
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Local login FATAL error');
        res.status(500).json({ error: 'Server error during login' });
    }
});

router.post('/login', loginRateLimit, validateBody(z.object({
    id: z.string().min(1, 'User ID is required'),
    password: z.string().min(1, 'Password is required'),
}).passthrough()), async (req: Request, res: Response) => {
    try {
        const { id, password } = req.body;
        logger.debug({ id }, '[Auth] Login attempt started');

        const userResults = await db.select().from(users).where(eq(users.id, id)).limit(1);
        const user = userResults[0];

        if (!user || !user.password) {
            // Constant-time: always run Argon2 to prevent timing-based user enumeration
            await verifyPassword(DUMMY_ARGON2_HASH, password);
            logger.warn({ id, found: !!user, hasPassword: !!user?.password }, '[Auth] Login failed: User not found or no password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Local login is only available for platform operators (unless DEMO_MODE is enabled)
        if (!user.isPlatformOperator && !config.DEMO_MODE) {
            logger.warn({ id }, '[Auth] Local login rejected: non-platform user must use SSO');
            return res.status(403).json({ error: 'Local login is not available. Please use SSO to sign in.' });
        }

        // Account lockout check
        const lockout = checkLockout(user);
        if (lockout.locked) {
            const retryMins = Math.ceil((lockout.retryAfterMs || 0) / 60000);
            return res.status(423).json({ error: `Account locked. Try again in ${retryMins} minute(s).` });
        }

        const isMatch = await verifyPassword(user.password, password);
        if (!isMatch) {
            const result = await recordFailedLogin(user.id, !!user.isPlatformOperator);
            logger.warn({ id, attemptsLeft: result.attemptsLeft }, '[Auth] Login failed: Password mismatch');
            if (result.locked) {
                return res.status(423).json({ error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // ME-02 fix: Re-check lockout with fresh DB fetch (see login-local route for detailed explanation).
        const [freshUser] = await db.select({ lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, user.id)).limit(1);
        if (freshUser) {
            const lockoutAfterPw = checkLockout({ lockedUntil: freshUser.lockedUntil });
            if (lockoutAfterPw.locked) {
                const retryMins = Math.ceil((lockoutAfterPw.retryAfterMs || 0) / 60000);
                return res.status(423).json({ error: `Account locked. Try again in ${retryMins} minute(s).` });
            }
        }

        const userMemberships = await listUserMemberships(user.id);

        logger.debug({ id, membershipCount: userMemberships.length }, '[Auth] Membership lookup complete');

        if (userMemberships.length === 0 && !isPlatformAdmin(!!user.isPlatformOperator)) {
            logger.warn({ id }, '[Auth] Login failed: No memberships found');
            return res.status(403).json({ error: 'User has no memberships' });
        }

        // Check if MFA is enabled
        if (user.mfaEnabledAt) {
            const { totpCode } = req.body;
            if (!totpCode) {
                // Return MFA challenge — client must re-submit with id+password+totpCode
                return res.status(401).json({ mfaRequired: true });
            }
            const { verifyTotpToken, isTotpTokenUsed, markTotpTokenUsed } = await import('../../services/platformStepUp.js');
            const totpAlreadyUsed = await isTotpTokenUsed(user.id, totpCode);
            if (!user.mfaSecret || totpAlreadyUsed || !verifyTotpToken(user.mfaSecret, totpCode)) {
                const recoveryCodes = (user.mfaRecoveryCodes as string[]) || [];
                const codeHash = crypto.createHash('sha256').update(totpCode).digest('hex');
                const recoveryIdx = findRecoveryCodeIndex(recoveryCodes, codeHash);
                if (recoveryIdx === -1) {
                    const mfaFailResult = await recordFailedLogin(user.id, !!user.isPlatformOperator);
                    logger.warn({ id, attemptsLeft: mfaFailResult.attemptsLeft }, '[Auth] Login failed: Invalid MFA code');
                    if (mfaFailResult.locked) {
                        return res.status(423).json({ error: 'Account locked due to too many failed attempts. Try again in 15 minutes.' });
                    }
                    return res.status(401).json({ error: 'Invalid MFA code' });
                }
                const updatedCodes = [...recoveryCodes];
                updatedCodes.splice(recoveryIdx, 1);
                await db.update(users).set({ mfaRecoveryCodes: updatedCodes }).where(eq(users.id, user.id));
                logger.info({ userId: user.id }, '[Auth] MFA passed via recovery code');
            } else {
                await markTotpTokenUsed(user.id, totpCode);
            }
        }

        // Fully authenticated — reset lockout counter (after MFA if applicable)
        await resetFailedLogins(user.id);

        const activeMemberships = userMemberships.filter(m => m.status === 'active');
        const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

        const token = await buildAuthToken({
            userId: user.id,
            role: defaultMembership?.role || 'agent',
            departments: (defaultMembership?.departments as unknown[]) || [],
            partnerId: defaultMembership?.partnerId,
            membershipId: defaultMembership?.id,
            isPlatformOperator: !!user.isPlatformOperator,
            platformStepUpAt: undefined,
        });

        logger.info({ id, partnerId: defaultMembership?.partnerId }, '[Auth] Login successful');

        // Update lastActiveAt
        await db.update(users).set({ lastActiveAt: new Date().toISOString() }).where(eq(users.id, user.id));

        setAuthCookie(res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));
        const refreshResult = await createRefreshToken(user.id, defaultMembership?.partnerId);
        setRefreshCookie(res, refreshResult.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));
        res.json(buildAuthResponse({
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
        }));
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Login FATAL error');
        res.status(500).json({ error: 'Server error during login' });
    }
});

}
