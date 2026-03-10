import express from 'express';
import { query, run } from '../db/sqlite.js';
import { auth, authorize } from '../middleware/auth.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validator.js';

const router = express.Router();

// GET /api/canned-responses
router.get('/', [auth, authorize(['agent', 'expert', 'admin'])], (req, res) => {
    try {
        const responses = query('SELECT * FROM canned_responses ORDER BY shortcut ASC');
        res.json(responses);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/canned-responses (manager only)
router.post(
    '/',
    [
        auth,
        authorize(['admin']),
        body('shortcut').trim().notEmpty(),
        body('text').trim().notEmpty(),
        validate
    ],
    (req, res) => {
        try {
            const { shortcut, text } = req.body;
            const id = `cr${Date.now()}`;
            run('INSERT INTO canned_responses (id, shortcut, text) VALUES (?, ?, ?)', [id, shortcut, text]);
            res.status(201).json({ id, shortcut, text });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(400).json({ error: 'Shortcut already exists.' });
            }
            res.status(500).json({ error: err.message });
        }
    }
);

// DELETE /api/canned-responses/:id (manager only)
router.delete('/:id', [auth, authorize(['admin'])], (req, res) => {
    try {
        const { id } = req.params;
        const result = run('DELETE FROM canned_responses WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Response not found' });
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
