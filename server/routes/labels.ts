import express, { Request, Response } from 'express';
import { query, run, transaction } from '../db.js';
import logger from '../utils/logger.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validator.js';
import { auth, authorize, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    try {
        const labels = await query('SELECT id, name as text, color FROM labels ORDER BY name ASC');
        res.json(labels);
    } catch (err: any) {
        logger.error({ err: err.message }, 'Error fetching labels');
        res.status(500).json({ error: err.message });
    }
});

router.post('/', [
    auth,
    authorize(['admin']),
    body('text').notEmpty().trim().withMessage('Label text is required'),
    body('color').notEmpty().withMessage('Color is required'),
    validate([])
], async (req: AuthRequest, res: Response) => {
    try {
        const { text, color } = req.body;
        if (!text || !color) return res.status(400).json({ error: 'Missing field' });

        const id = 'l' + Date.now();
        await run('INSERT INTO labels (id, name, color) VALUES ($1, $2, $3)', [id, text, color]);

        res.status(201).json({ id, text, color });
    } catch (err: any) {
        logger.error({ err: err.message, body: req.body }, 'Error adding label');
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', [auth, authorize(['admin'])], async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        await transaction(async () => {
            await run('DELETE FROM ticket_labels WHERE label_id = $1', [id]);
            await run('DELETE FROM labels WHERE id = $1', [id]);
        });

        const io = req.app.get('io');
        if (io) {
            io.emit('label:deleted', { id });
        }

        res.status(204).end();
    } catch (err: any) {
        logger.error({ err: err.message, labelId: req.params.id }, 'Error deleting label');
        res.status(500).json({ error: err.message });
    }
});

export default router;
