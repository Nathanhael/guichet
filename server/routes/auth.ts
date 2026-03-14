import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { body } from 'express-validator';
import { get, run } from '../db.js';
import { validate } from '../middleware/validator.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { User } from '../types/index.js';

const router = express.Router();

router.post('/register', [
    body('id').notEmpty().withMessage('User ID is required'),
    body('name').notEmpty().withMessage('Name is required'),
    body('role').isIn(['agent', 'support', 'admin']),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    validate([])
], async (req: Request, res: Response) => {
    try {
        const { id, name, role, dept, lang, password } = req.body;

        const existing = await get('SELECT id FROM users WHERE id = $1', [id]);
        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await run(
            'INSERT INTO users (id, name, role, dept, lang, password) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, name, role, dept || null, lang || 'nl', hashedPassword]
        );

        res.status(201).json({ message: 'User registered successfully' });
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Registration error');
        res.status(500).json({ error: 'Server error during registration' });
    }
});

router.post('/login', [
    body('id').notEmpty().withMessage('User ID is required'),
    body('password').notEmpty().withMessage('Password is required'),
    validate([])
], async (req: Request, res: Response) => {
    try {
        const { id, password } = req.body;

        const user = (await get('SELECT * FROM users WHERE id = $1', [id])) as unknown as User;
        if (!user || !user.password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Fetch memberships and partner details
        const userMemberships = await (await import('../db.js')).query(
            `SELECT m.*, p.name as partner_name, p.industry, p.primary_color, p.secondary_color, p.ref_1_label, p.ref_2_label, p.departments, p.ai_rules
             FROM memberships m
             JOIN partners p ON m.partner_id = p.id
             WHERE m.user_id = $1`,
            [user.id]
        ) as any[];

        if (userMemberships.length === 0 && !user.isPlatformOperator) {
            return res.status(403).json({ error: 'User has no active memberships' });
        }

        // Default to first membership for now
        const activeMembership = userMemberships[0];

        const token = jwt.sign(
            { 
                userId: user.id, 
                role: activeMembership?.role || 'platform_operator', 
                dept: activeMembership?.dept,
                partnerId: activeMembership?.partner_id,
                membershipId: activeMembership?.id,
                isPlatformOperator: user.isPlatformOperator
            },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRY } as jwt.SignOptions
        );

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
                partnerId: m.partner_id,
                partnerName: m.partner_name,
                role: m.role,
                dept: m.dept,
                manifest: {
                    industry: m.industry,
                    primaryColor: m.primary_color,
                    secondaryColor: m.secondary_color,
                    ref1Label: m.ref_1_label,
                    ref2Label: m.ref_2_label,
                    departments: JSON.parse(m.departments || '[]'),
                    aiRules: m.ai_rules
                }
            })),
            activePartnerId: activeMembership?.partner_id
        });
    } catch (err: unknown) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Login error');
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
