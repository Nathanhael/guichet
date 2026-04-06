import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { auditLog, partners, memberships, users } from '../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody } from '../middleware/validator.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { User } from '../types/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { MailService } from '../services/mail.js';
import { hashPassword, verifyPassword, validatePasswordStrength, isPasswordReused, PASSWORD_HISTORY_LIMIT } from '../utils/passwords.js';
import { checkLockout, recordFailedLogin, resetFailedLogins } from '../services/accountLockout.js';
import { buildAuthResponse, buildAuthToken, findUserByEmail, getEnterPartnerContext, listUserMemberships, setAuthCookie, clearAuthCookie, parseExpiryToSeconds } from '../services/authSession.js';
import { canAccessPartnerContext, isPlatformAdmin } from '../services/roles.js';
import { revokeToken, revokeUserSessions } from '../services/sessionRevocation.js';
import { isPlatformStepUpSatisfied } from '../services/platformStepUp.js';
import { createRefreshToken, rotateRefreshToken, revokeAllUserRefreshTokens } from '../services/refreshToken.js';

const router = express.Router();
logger.info('[Auth] Routes file loaded');

// ---------------------------------------------------------------------------
// IP-based rate limiter for auth endpoints (Redis-backed, multi-instance safe)
// ---------------------------------------------------------------------------
const AUTH_RATE_WINDOW_SECS = 15 * 60; // 15 minutes
const AUTH_RATE_MAX_LOGIN = 20; // max login attempts per IP per window
const AUTH_RATE_MAX_RESET = 10; // max reset-password attempts per IP per window

// In-memory fallback rate limiter when Redis is unavailable
const memoryLimiter = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_CLEANUP_INTERVAL = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memoryLimiter) {
    if (val.expiresAt <= now) memoryLimiter.delete(key);
  }
}, MEMORY_CLEANUP_INTERVAL);

function fallbackRateLimit(key: string, maxAttempts: number, windowSecs: number): { allowed: boolean; retryAfterSecs: number } {
  const now = Date.now();
  const entry = memoryLimiter.get(key);

  if (entry && entry.expiresAt > now) {
    entry.count++;
    if (entry.count > maxAttempts) {
      return { allowed: false, retryAfterSecs: Math.ceil((entry.expiresAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSecs: 0 };
  }

  memoryLimiter.set(key, { count: 1, expiresAt: now + windowSecs * 1000 });
  return { allowed: true, retryAfterSecs: 0 };
}

/**
 * Generic Redis-backed IP rate limiter. Falls back to in-memory rate limiting if Redis is unavailable.
 */
async function redisRateLimit(
  req: Request,
  res: Response,
  next: () => void,
  prefix: string,
  maxAttempts: number,
): Promise<void> {
  if (config.DISABLE_RATE_LIMIT) {
    next();
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) {
      // Redis unavailable — use in-memory fallback to still enforce rate limiting
      const fallbackKey = `rate:${prefix}:${ip}`;
      const result = fallbackRateLimit(fallbackKey, maxAttempts, AUTH_RATE_WINDOW_SECS);
      if (!result.allowed) {
        logger.warn({ ip, prefix }, `[Auth] IP rate limit exceeded on ${prefix} (fallback)`);
        res.set('Retry-After', String(result.retryAfterSecs));
        res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        return;
      }
      next();
      return;
    }
    const key = `rate:${prefix}:${ip}`;
    const count = await pubClient.incr(key);
    if (count === 1) {
      await pubClient.expire(key, AUTH_RATE_WINDOW_SECS);
    }
    if (count > maxAttempts) {
      const ttl = await pubClient.ttl(key);
      const retryAfterSecs = ttl > 0 ? ttl : AUTH_RATE_WINDOW_SECS;
      logger.warn({ ip, prefix, count }, `[Auth] IP rate limit exceeded on ${prefix}`);
      res.set('Retry-After', String(retryAfterSecs));
      res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      return;
    }
  } catch (err) {
    // Redis error — use in-memory fallback to still enforce rate limiting
    logger.warn({ err }, '[Auth] Redis rate limit check failed, using in-memory fallback');
    const fallbackKey = `rate:${prefix}:${ip}`;
    const result = fallbackRateLimit(fallbackKey, maxAttempts, AUTH_RATE_WINDOW_SECS);
    if (!result.allowed) {
      logger.warn({ ip, prefix }, `[Auth] IP rate limit exceeded on ${prefix} (fallback)`);
      res.set('Retry-After', String(result.retryAfterSecs));
      res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      return;
    }
  }
  next();
}

function loginRateLimit(req: Request, res: Response, next: () => void): void {
  redisRateLimit(req, res, next, 'login', AUTH_RATE_MAX_LOGIN);
}

function resetPasswordRateLimit(req: Request, res: Response, next: () => void): void {
  redisRateLimit(req, res, next, 'reset-pw', AUTH_RATE_MAX_RESET);
}

function setRefreshCookie(res: Response, token: string, maxAgeSecs: number): void {
  res.cookie('tessera_refresh', token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth/refresh',
    maxAge: maxAgeSecs * 1000,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie('tessera_refresh', {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth/refresh',
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local[0]}***@${domain}`;
}

/**
 * M-02: Timing-safe recovery code lookup.
 * Compares codeHash against all stored hashes using timingSafeEqual
 * to avoid leaking which index matched via timing side-channel.
 */
function findRecoveryCodeIndex(recoveryCodes: string[], codeHash: string): number {
  const codeBuffer = Buffer.from(codeHash, 'hex');
  let foundIdx = -1;
  for (let i = 0; i < recoveryCodes.length; i++) {
    const storedBuffer = Buffer.from(recoveryCodes[i], 'hex');
    if (codeBuffer.length === storedBuffer.length && crypto.timingSafeEqual(codeBuffer, storedBuffer)) {
      foundIdx = i;
      // Don't break — continue checking all codes to maintain constant time
    }
  }
  return foundIdx;
}

// ... (register route remains unchanged)

import { getRedisClients } from '../utils/redis.js';

const FORGOT_PW_WINDOW_SECS = 60;
const FORGOT_PW_MAX_PER_EMAIL = 3;

router.post('/forgot-password', resetPasswordRateLimit, validateBody(z.object({
    email: z.string().email('Valid email is required'),
}).passthrough()), async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        logger.info({ email: maskEmail(email) }, '[Auth] Password reset requested');

        // Per-email rate limiting via Redis (multi-instance safe)
        const redisKey = `forgot-pwd:${email.toLowerCase()}`;
        try {
            const { pubClient } = getRedisClients();
            if (pubClient) {
                const count = await pubClient.incr(redisKey);
                if (count === 1) {
                    await pubClient.expire(redisKey, FORGOT_PW_WINDOW_SECS);
                }
                if (count > FORGOT_PW_MAX_PER_EMAIL) {
                    logger.warn({ email: maskEmail(email) }, '[Auth] Forgot password per-email rate limit hit');
                    return res.json({ success: true, message: 'If an account exists, you will receive a reset link.' });
                }
            }
        } catch (redisErr) {
            logger.warn({ err: redisErr }, '[Auth] Redis throttle check failed, proceeding without throttle');
        }

        const user = await findUserByEmail(email);

        // Security: Always return success to prevent user enumeration
        if (!user) {
            logger.warn({ email: maskEmail(email) }, '[Auth] Password reset failed: User not found (enumeration protected)');
            return res.json({ success: true, message: 'If an account exists, you will receive a reset link.' });
        }

        // Forgot-password is only for platform operators — return generic success to avoid enumeration
        if (!user.isPlatformOperator) {
            return res.json({ message: 'If an account exists with this email, a reset link has been sent.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour

        await db.update(users)
            .set({ 
                resetPasswordToken: hashedToken, 
                resetPasswordExpires: expires 
            })
            .where(eq(users.id, user.id));

        const emailSent = await MailService.sendPasswordReset(user.email!, user.name, token);
        
        if (!emailSent) {
            logger.error({ email: maskEmail(email) }, '[Auth] Failed to send password reset email');
            // We still return success to the user, but maybe a slightly different message or log it
        }

        res.json({ success: true, message: 'If an account exists, you will receive a reset link.' });
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Forgot password FATAL error');
        res.status(500).json({ error: 'Server error processing request' });
    }
});

router.post('/reset-password', resetPasswordRateLimit, validateBody(z.object({
    token: z.string().min(1, 'Token is required'),
    password: z.string().min(10, 'Password must be at least 10 characters'),
}).passthrough()), async (req: Request, res: Response) => {
    try {
        const { token, password, totpCode } = req.body;
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const userResults = await db.select().from(users).where(eq(users.resetPasswordToken, hashedToken)).limit(1);
        const user = userResults[0];

        if (!user || !user.resetPasswordExpires || new Date(user.resetPasswordExpires) < new Date()) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        // Password reset is only for platform operators
        if (!user.isPlatformOperator) {
            return res.status(403).json({ error: 'Password reset is not available for this account.' });
        }

        // Lockout check — prevents TOTP brute-force via reset token
        const lockout = checkLockout(user);
        if (lockout.locked) {
            const retryMins = Math.ceil((lockout.retryAfterMs || 0) / 60000);
            return res.status(423).json({
                error: `Account locked. Try again in ${retryMins} minute(s).`,
            });
        }

        // MFA verification: if user has MFA enabled, require TOTP code for password reset
        if (user.mfaEnabledAt) {
            if (!totpCode) {
                return res.status(403).json({ error: 'MFA verification required for password reset' });
            }
            const { verifyTotpToken, isTotpTokenUsed, markTotpTokenUsed } = await import('../services/platformStepUp.js');
            const totpAlreadyUsed = await isTotpTokenUsed(user.id, totpCode);
            if (!user.mfaSecret || totpAlreadyUsed || !verifyTotpToken(user.mfaSecret, totpCode)) {
                // Also check recovery codes
                const recoveryCodes = (user.mfaRecoveryCodes as string[]) || [];
                const codeHash = crypto.createHash('sha256').update(totpCode).digest('hex');
                const recoveryIdx = findRecoveryCodeIndex(recoveryCodes, codeHash);
                if (recoveryIdx === -1) {
                    await recordFailedLogin(user.id);
                    return res.status(401).json({ error: 'Invalid MFA code' });
                }
                // Consume the recovery code
                const updatedCodes = [...recoveryCodes];
                updatedCodes.splice(recoveryIdx, 1);
                await db.update(users).set({ mfaRecoveryCodes: updatedCodes }).where(eq(users.id, user.id));
            } else {
                await markTotpTokenUsed(user.id, totpCode);
            }
        }

        // Password strength validation
        const strength = validatePasswordStrength(password, { email: user.email ?? undefined, name: user.name });
        if (!strength.valid) {
            return res.status(400).json({ error: 'Password does not meet security requirements', details: strength.errors });
        }

        // Password reuse check
        const history = (user.passwordHistory as string[]) || [];
        if (history.length > 0 && await isPasswordReused(password, history)) {
            return res.status(400).json({ error: `Password was used recently. Choose a password you haven't used in the last ${PASSWORD_HISTORY_LIMIT} changes.` });
        }

        const hashedPassword = await hashPassword(password);

        // Update password and push old hash to history
        const newHistory = user.password ? [user.password, ...history].slice(0, PASSWORD_HISTORY_LIMIT) : history;

        await db.update(users)
            .set({
                password: hashedPassword,
                resetPasswordToken: null,
                resetPasswordExpires: null,
                passwordChangedAt: new Date().toISOString(),
                passwordHistory: newHistory,
                failedLoginAttempts: 0,
                lockedUntil: null,
            })
            .where(eq(users.id, user.id));

        // Revoke all existing sessions so a compromised token cannot be reused
        await revokeUserSessions(user.id);

        logger.info({ userId: user.id }, '[Auth] Password reset successful, all sessions revoked');
        res.json({ success: true, message: 'Password updated successfully' });
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Reset password FATAL error');
        res.status(500).json({ error: 'Server error updating password' });
    }
});

router.post('/login-local', loginRateLimit, validateBody(z.object({
    email: z.string().email('Valid email is required'),
    password: z.string().min(1, 'Password is required'),
}).passthrough()), async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        logger.info({ email: maskEmail(email) }, '[Auth] Local login attempt started');

        const user = await findUserByEmail(email);

        if (!user || !user.password) {
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
            const result = await recordFailedLogin(user.id);
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
                return res.status(200).json({ mfaRequired: true });
            }
            // Verify TOTP code (import inline to avoid circular deps)
            const { verifyTotpToken, isTotpTokenUsed, markTotpTokenUsed } = await import('../services/platformStepUp.js');
            const totpAlreadyUsed = await isTotpTokenUsed(user.id, totpCode);
            if (!user.mfaSecret || totpAlreadyUsed || !verifyTotpToken(user.mfaSecret, totpCode)) {
                // Check recovery codes
                const recoveryCodes = (user.mfaRecoveryCodes as string[]) || [];
                const codeHash = crypto.createHash('sha256').update(totpCode).digest('hex');
                const recoveryIdx = findRecoveryCodeIndex(recoveryCodes, codeHash);
                if (recoveryIdx === -1) {
                    const mfaFailResult = await recordFailedLogin(user.id);
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
            const result = await recordFailedLogin(user.id);
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
                return res.status(200).json({ mfaRequired: true });
            }
            const { verifyTotpToken, isTotpTokenUsed, markTotpTokenUsed } = await import('../services/platformStepUp.js');
            const totpAlreadyUsed = await isTotpTokenUsed(user.id, totpCode);
            if (!user.mfaSecret || totpAlreadyUsed || !verifyTotpToken(user.mfaSecret, totpCode)) {
                const recoveryCodes = (user.mfaRecoveryCodes as string[]) || [];
                const codeHash = crypto.createHash('sha256').update(totpCode).digest('hex');
                const recoveryIdx = findRecoveryCodeIndex(recoveryCodes, codeHash);
                if (recoveryIdx === -1) {
                    const mfaFailResult = await recordFailedLogin(user.id);
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
                accessibilityPrefs: user.accessibilityPrefs ?? {},
            },
            memberships: userMemberships,
        }));
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Login FATAL error');
        res.status(500).json({ error: 'Server error during login' });
    }
});

router.post('/switch-partner', (await import('../middleware/auth.js')).auth, async (req: AuthRequest, res: Response) => {
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

router.post('/refresh', async (req: Request, res: Response) => {
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

router.post('/logout', (await import('../middleware/auth.js')).auth, async (req: AuthRequest, res: Response) => {
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

router.post('/enter-partner', (await import('../middleware/auth.js')).auth, async (req: AuthRequest, res: Response) => {
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

export default router;

