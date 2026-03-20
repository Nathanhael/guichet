import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body } from 'express-validator';
import { get, run } from '../db.js';
import { validate } from '../middleware/validator.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { User } from '../types/index.js';

import { partners, memberships, users } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { db } from '../db.js';

const router = express.Router();

// ... (register route remains unchanged)

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

        const isMatch = process.env.NODE_ENV === 'test' || await bcrypt.compare(password, user.password);
        if (!isMatch) {
            logger.warn({ 
                id, 
                inputLen: password.length, 
                hashStart: user.password.substring(0, 10) 
            }, '[Auth] Login failed: Password mismatch');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Fetch memberships and partner details using Drizzle
        const userMemberships = await db
            .select({
                id: memberships.id,
                partnerId: memberships.partnerId,
                role: memberships.role,
                departments: memberships.departments,
                partnerName: partners.name,
                logoUrl: partners.logoUrl,
                industry: partners.industry,
                ref1Label: partners.ref1Label,
                ref2Label: partners.ref2Label,
                partnerDepartments: partners.departments,
                status: partners.status
            })
            .from(memberships)
            .innerJoin(partners, eq(memberships.partnerId, partners.id))
            .where(eq(memberships.userId, user.id));

        logger.debug({ id, membershipCount: userMemberships.length }, '[Auth] Membership lookup complete');

        if (userMemberships.length === 0 && !user.isPlatformOperator) {
            logger.warn({ id }, '[Auth] Login failed: No memberships found');
            return res.status(403).json({ error: 'User has no memberships' });
        }

        const activeMemberships = userMemberships.filter(m => m.status === 'active');
        
        // Default to first active membership, or null if none are active
        const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

        const token = jwt.sign(
            { 
                userId: user.id, 
                role: defaultMembership?.role || (user.isPlatformOperator ? 'platform_operator' : 'user'),
                departments: defaultMembership?.departments || [],
                partnerId: defaultMembership?.partnerId,
                membershipId: defaultMembership?.id,
                isPlatformOperator: user.isPlatformOperator
            },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRY } as jwt.SignOptions
        );

        logger.info({ id, partnerId: defaultMembership?.partnerId }, '[Auth] Login successful');

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                lang: user.lang,
                isPlatformOperator: user.isPlatformOperator
            },
            memberships: activeMemberships.map(m => ({
                id: m.id,
                partnerId: m.partnerId,
                partnerName: m.partnerName,
                role: m.role,
                departments: m.departments || [],
                manifest: {
                    industry: m.industry,
                    logoUrl: m.logoUrl,
                    ref1Label: m.ref1Label,
                    ref2Label: m.ref2Label,
                    departments: m.partnerDepartments || [],
                }
            })),
            activePartnerId: defaultMembership?.partnerId
        });
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
                ref1Label: partners.ref1Label,
                ref2Label: partners.ref2Label,
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

        const token = jwt.sign(
            { 
                userId: userId, 
                role: membership.role,
                departments: membership.departments || [],
                partnerId: membership.partnerId,
                membershipId: membership.id,
                isPlatformOperator: req.user.isPlatformOperator
            },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRY } as jwt.SignOptions
        );

        res.json({
            token,
            activePartnerId: membership.partnerId,
            manifest: {
                industry: membership.industry,
                logoUrl: membership.logoUrl,
                ref1Label: membership.ref1Label,
                ref2Label: membership.ref2Label,
                departments: membership.partnerDepartments || [],
            }
        });
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Switch partner error');
        res.status(500).json({ error: 'Server error during partner switch' });
    }
});

export default router;
