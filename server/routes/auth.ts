import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
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

        const isMatch = await bcrypt.compare(password, user.password);
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
                dept: memberships.dept,
                partnerName: partners.name,
                industry: partners.industry,
                primaryColor: partners.primaryColor,
                secondaryColor: partners.secondaryColor,
                ref1Label: partners.ref1Label,
                ref2Label: partners.ref2Label,
                departments: partners.departments,
                aiRules: partners.aiRules
            })
            .from(memberships)
            .innerJoin(partners, eq(memberships.partnerId, partners.id))
            .where(eq(memberships.userId, user.id));

        logger.debug({ id, membershipCount: userMemberships.length }, '[Auth] Membership lookup complete');

        if (userMemberships.length === 0 && !user.isPlatformOperator) {
            logger.warn({ id }, '[Auth] Login failed: No memberships found');
            return res.status(403).json({ error: 'User has no active memberships' });
        }

        // Default to first membership
        const activeMembership = userMemberships[0];

        const token = jwt.sign(
            { 
                userId: user.id, 
                role: activeMembership?.role || 'platform_operator', 
                dept: activeMembership?.dept,
                partnerId: activeMembership?.partnerId,
                membershipId: activeMembership?.id,
                isPlatformOperator: user.isPlatformOperator
            },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRY } as jwt.SignOptions
        );

        logger.info({ id, partnerId: activeMembership?.partnerId }, '[Auth] Login successful');

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                lang: user.lang,
                isPlatformOperator: user.isPlatformOperator
            },
            memberships: userMemberships.map(m => ({
                id: m.id,
                partnerId: m.partnerId,
                partnerName: m.partnerName,
                role: m.role,
                dept: m.dept,
                manifest: {
                    industry: m.industry,
                    primaryColor: m.primaryColor,
                    secondaryColor: m.secondaryColor,
                    ref1Label: m.ref1Label,
                    ref2Label: m.ref2Label,
                    departments: JSON.parse(m.departments || '[]'),
                    aiRules: m.aiRules
                }
            })),
            activePartnerId: activeMembership?.partnerId
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

        const membership = await get(
            `SELECT m.*, p.name as partner_name, p.industry, p.primary_color, p.secondary_color, p.ref_1_label, p.ref_2_label, p.departments, p.ai_rules
             FROM memberships m
             JOIN partners p ON m.partner_id = p.id
             WHERE m.id = $1 AND m.user_id = $2`,
            [membershipId, userId]
        ) as any;

        if (!membership) {
            return res.status(403).json({ error: 'Invalid membership for this user' });
        }

        const token = jwt.sign(
            { 
                userId: userId, 
                role: membership.role, 
                dept: membership.dept,
                partnerId: membership.partner_id,
                membershipId: membership.id,
                isPlatformOperator: req.user.isPlatformOperator
            },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRY } as jwt.SignOptions
        );

        res.json({
            token,
            activePartnerId: membership.partner_id,
            manifest: {
                industry: membership.industry,
                primaryColor: membership.primary_color,
                secondaryColor: membership.secondary_color,
                ref1Label: membership.ref_1_label,
                ref2Label: membership.ref_2_label,
                departments: JSON.parse(membership.departments || '[]'),
                aiRules: membership.ai_rules
            }
        });
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Switch partner error');
        res.status(500).json({ error: 'Server error during partner switch' });
    }
});

export default router;
