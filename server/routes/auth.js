import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { body } from 'express-validator';
import { query, get, run } from '../db.js';
import { validate } from '../middleware/validator.js';
import config from '../config.js';
import logger from '../utils/logger.js';

const router = express.Router();

// POST /api/auth/register
router.post('/register', [
    body('id').notEmpty().withMessage('User ID is required'),
    body('name').notEmpty().withMessage('Name is required'),
    body('role').isIn(['agent', 'expert', 'admin']),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    validate
], async (req, res) => {
    try {
        const { id, name, role, dept, lang, password } = req.body;

        const existing = get('SELECT id FROM users WHERE id = ?', [id]);
        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        run(
            'INSERT INTO users (id, name, role, dept, lang, password) VALUES (?, ?, ?, ?, ?, ?)',
            [id, name, role, dept || null, lang || 'nl', hashedPassword]
        );

        res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
        logger.error({ err: err.message }, 'Registration error');
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// POST /api/auth/login
router.post('/login', [
    body('id').notEmpty().withMessage('User ID is required'),
    body('password').notEmpty().withMessage('Password is required'),
    validate
], async (req, res) => {
    try {
        const { id, password } = req.body;

        const user = get('SELECT * FROM users WHERE id = ?', [id]);
        if (!user || !user.password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, dept: user.dept },
            config.JWT_SECRET,
            { expiresIn: config.JWT_EXPIRY }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                dept: user.dept,
                lang: user.lang
            }
        });
    } catch (err) {
        logger.error({ err: err.message }, 'Login error');
        res.status(500).json({ error: 'Server error during login' });
    }
});

export default router;
