import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { validateBody } from '../../middleware/validator.js';
import logger from '../../utils/logger.js';
import { MailService } from '../../services/mail.js';
import { hashPassword, validatePasswordStrength, isPasswordReused, PASSWORD_HISTORY_LIMIT } from '../../utils/passwords.js';
import { checkLockout, recordFailedLogin } from '../../services/accountLockout.js';
import { findUserByEmail } from '../../services/authSession.js';
import { revokeUserSessions } from '../../services/sessionRevocation.js';
import { getRedisClients } from '../../utils/redis.js';
import { resetPasswordRateLimit, FORGOT_PW_WINDOW_SECS, FORGOT_PW_MAX_PER_EMAIL, maskEmail, findRecoveryCodeIndex } from './rateLimit.js';

export function registerPasswordRoutes(router: express.Router): void {
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
                const { verifyTotpToken, isTotpTokenUsed, markTotpTokenUsed } = await import('../../services/platformStepUp.js');
                const totpAlreadyUsed = await isTotpTokenUsed(user.id, totpCode);
                if (!user.mfaSecret || totpAlreadyUsed || !verifyTotpToken(user.mfaSecret, totpCode)) {
                    // Also check recovery codes
                    const recoveryCodes = (user.mfaRecoveryCodes as string[]) || [];
                    const codeHash = crypto.createHash('sha256').update(totpCode).digest('hex');
                    const recoveryIdx = findRecoveryCodeIndex(recoveryCodes, codeHash);
                    if (recoveryIdx === -1) {
                        await recordFailedLogin(user.id, !!user.isPlatformOperator);
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
}
