import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { body } from 'express-validator';
import { get, run } from '../db.js';
import { validate } from '../middleware/validator.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { User } from '../types/index.js';
import { MailService } from '../services/mail.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';
import { buildAuthResponse, buildAuthToken, findUserByEmail, getEnterPartnerContext, listUserMemberships } from '../services/authSession.js';
import { canAccessPartnerContext, isPlatformAdmin } from '../services/roles.js';
import { revokeToken } from '../services/sessionRevocation.js';
import { isPlatformStepUpSatisfied } from '../services/platformStepUp.js';

import { auditLog, partners, memberships, users } from '../db/schema.js';
import { eq, and, ilike, isNull } from 'drizzle-orm';
import { db } from '../db.js';

const router = express.Router();
logger.info('[Auth] Routes file loaded');

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local[0]}***@${domain}`;
}

// ... (register route remains unchanged)

router.post('/forgot-password', [
    body('email').isEmail().withMessage('Valid email is required'),
    validate([])
], async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        logger.info({ email: maskEmail(email) }, '[Auth] Password reset requested');

        const user = await findUserByEmail(email);

        // Security: Always return success to prevent user enumeration
        if (!user) {
            logger.warn({ email: maskEmail(email) }, '[Auth] Password reset failed: User not found (enumeration protected)');
            return res.json({ success: true, message: 'If an account exists, you will receive a reset link.' });
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

router.post('/reset-password', [
    body('token').notEmpty().withMessage('Token is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    validate([])
], async (req: Request, res: Response) => {
    try {
        const { token, password } = req.body;
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const userResults = await db.select().from(users).where(eq(users.resetPasswordToken, hashedToken)).limit(1);
        const user = userResults[0];

        if (!user || !user.resetPasswordExpires || new Date(user.resetPasswordExpires) < new Date()) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const hashedPassword = await hashPassword(password);

        await db.update(users)
            .set({ 
                password: hashedPassword,
                resetPasswordToken: null,
                resetPasswordExpires: null
            })
            .where(eq(users.id, user.id));

        logger.info({ userId: user.id }, '[Auth] Password reset successful');
        res.json({ success: true, message: 'Password updated successfully' });
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Reset password FATAL error');
        res.status(500).json({ error: 'Server error updating password' });
    }
});

router.post('/login-local', [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    validate([])
], async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        logger.info({ email: maskEmail(email) }, '[Auth] Local login attempt started');

        const user = await findUserByEmail(email);

        if (!user || !user.password) {
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login failed: User not found or no password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await verifyPassword(user.password, password);

        if (!isMatch) {
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login failed: Password mismatch');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userMemberships = await listUserMemberships(user.id);

        logger.info({ email: maskEmail(email), membershipCount: userMemberships.length }, '[Auth] Local login membership lookup complete');

        if (userMemberships.length === 0 && !isPlatformAdmin(!!user.isPlatformOperator)) {
            logger.warn({ email: maskEmail(email) }, '[Auth] Local login failed: No memberships found');
            return res.status(403).json({ error: 'User has no memberships' });
        }

        const activeMemberships = userMemberships.filter(m => m.status === 'active');
        const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

        const token = buildAuthToken({
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
        logger.info({ userId: user.id }, '[Auth] Updating lastActiveAt for user');
        await db.update(users).set({ lastActiveAt: new Date().toISOString() }).where(eq(users.id, user.id));

        res.json(buildAuthResponse({
            token,
            user: {
                id: user.id,
                name: user.name,
                lang: user.lang,
                isPlatformOperator: user.isPlatformOperator,
            },
            memberships: userMemberships,
        }));
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Local login FATAL error');
        res.status(500).json({ error: 'Server error during login' });
    }
});

router.post('/login', [
    body('id').notEmpty().withMessage('User ID is required'),
    body('password').notEmpty().withMessage('Password is required'),
    validate([])
], async (req: Request, res: Response) => {
    try {
        const { id, password } = req.body;
        logger.debug({ id }, '[Auth] Login attempt started');

        const userResults = await db.select().from(users).where(eq(users.id, id)).limit(1);
        const user = userResults[0];

        if (!user || !user.password) {
            logger.warn({ id, found: !!user, hasPassword: !!user?.password }, '[Auth] Login failed: User not found or no password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await verifyPassword(user.password, password);
        if (!isMatch) {
            logger.warn({ id }, '[Auth] Login failed: Password mismatch');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const userMemberships = await listUserMemberships(user.id);

        logger.debug({ id, membershipCount: userMemberships.length }, '[Auth] Membership lookup complete');

        if (userMemberships.length === 0 && !isPlatformAdmin(!!user.isPlatformOperator)) {
            logger.warn({ id }, '[Auth] Login failed: No memberships found');
            return res.status(403).json({ error: 'User has no memberships' });
        }

        const activeMemberships = userMemberships.filter(m => m.status === 'active');
        
        // Default to first active membership, or null if none are active
        const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

        const token = buildAuthToken({
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

        res.json(buildAuthResponse({
            token,
            user: {
                id: user.id,
                name: user.name,
                lang: user.lang,
                isPlatformOperator: user.isPlatformOperator,
            },
            memberships: userMemberships,
        }));
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Login FATAL error');
        res.status(500).json({ error: 'Server error during login' });
    }
});

router.post('/switch-partner', (await import('../middleware/auth.js')).auth, async (req: any, res: Response) => {
    try {
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

        const token = buildAuthToken({
            userId,
            role: membership.role,
            departments: (membership.departments as unknown[]) || [],
            partnerId: membership.partnerId,
            membershipId: membership.id,
            isPlatformOperator: req.user.isPlatformOperator,
            platformStepUpAt: req.user.platformStepUpAt,
        });

        res.json({
            token,
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

router.post('/logout', (await import('../middleware/auth.js')).auth, async (req: any, res: Response) => {
    try {
        if (req.user?.tokenJti) {
            await revokeToken(req.user.tokenJti, req.user.tokenExp);
        }
        res.json({ success: true });
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Auth] Logout FATAL error');
        res.status(500).json({ error: 'Server error during logout' });
    }
});

router.post('/enter-partner', (await import('../middleware/auth.js')).auth, async (req: any, res: Response) => {
    try {
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

        const token = buildAuthToken({
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

        res.json({
            token,
            activePartnerId: partner.id,
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

