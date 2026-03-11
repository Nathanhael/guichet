import express, { Request, Response } from 'express';
import { query, run } from '../db.js';
import { auth, authorize, AuthRequest } from '../middleware/auth.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validator.js';

const router = express.Router();

router.get('/', [auth, authorize(['agent', 'expert', 'admin'])], async (req: AuthRequest, res: Response) => {
    try {
        const responses = await query('SELECT * FROM canned_responses ORDER BY shortcut ASC');
        res.json(responses);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post(
    '/',
    [
        auth,
        authorize(['admin']),
        body('shortcut').trim().notEmpty(),
        body('text').trim().notEmpty(),
        validate([])
    ],
    async (req: AuthRequest, res: Response) => {
        try {
            const { shortcut, text } = req.body;
            const id = `cr${Date.now()}`;
            await run('INSERT INTO canned_responses (id, shortcut, text) VALUES ($1, $2, $3)', [id, shortcut, text]);
            res.status(201).json({ id, shortcut, text });
        } catch (err: any) {
            if (err.code === '23505') { // Postgres unique constraint violation
                return res.status(400).json({ error: 'Shortcut already exists.' });
            }
            res.status(500).json({ error: err.message });
        }
    }
);

router.delete('/:id', [auth, authorize(['admin'])], async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const result = await run('DELETE FROM canned_responses WHERE id = $1', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Response not found' });
        res.json({ message: 'Deleted successfully' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
