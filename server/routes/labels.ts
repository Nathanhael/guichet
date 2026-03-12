import express, { Request, Response } from 'express';
import { query, run } from '../db.js';
import logger from '../utils/logger.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validator.js';
import { auth, authorize, AuthRequest } from '../middleware/auth.js';
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { labels, ticketLabels } from '../db/schema.js';

const router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    try {
        const labelsData = await query('SELECT id, name as text, color FROM labels ORDER BY name ASC');
        res.json(labelsData);
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
    validate([body('text'), body('color')])
], async (req: AuthRequest<any, any, { text: string; color: string }>, res: Response) => {
    try {
        const { text, color } = req.body;
        if (!text || !color) return res.status(400).json({ error: 'Missing field' });

        const id = 'l' + Date.now();
        await run('INSERT INTO labels (id, name, color) VALUES ($1, $2, $3)', [id, text, color]);

        const io = (req as any).app.get('io');
        if (io) {
            io.emit('label:created', { id, text, color });
        }

        res.status(201).json({ id, text, color });
    } catch (err: any) {
        const errMsg = String(err.message || err || '').toLowerCase();
        if (errMsg.includes('unique') || errMsg.includes('duplicate') || err.code === '23505') {
            return res.status(409).json({ error: 'Label name already exists' });
        }
        logger.error({ err: err.message, code: err.code, body: req.body }, 'Error adding label');
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', [auth, authorize(['admin'])], async (req: AuthRequest<{ id: string }>, res: Response) => {
    logger.info({ id: req.params.id }, 'Attempting label deletion');
    try {
        const { id } = req.params;

        await db.transaction(async (tx: any) => {
            await tx.delete(ticketLabels).where(eq(ticketLabels.labelId, id));
            await tx.delete(labels).where(eq(labels.id, id));
        });

        const io = (req as any).app.get('io');
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
