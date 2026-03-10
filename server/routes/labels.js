import express from 'express';
import { query, run, transaction } from '../db.js';
import logger from '../utils/logger.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validator.js';
import { auth, authorize } from '../middleware/auth.js';

const router = express.Router();

// Get all labels
router.get('/', async (req, res) => {
    try {
        const labels = query('SELECT id, name as text, color FROM labels ORDER BY name ASC');
        res.json(labels);
    } catch (err) {
        logger.error({ err: err.message }, 'Error fetching labels');
        res.status(500).json({ error: err.message });
    }
});

// Add a new label
router.post('/', [
    auth,
    authorize(['admin']),
    body('text').notEmpty().trim().withMessage('Label text is required'),
    body('color').notEmpty().withMessage('Color is required'),
    validate
], async (req, res) => {
    try {
        const { text, color } = req.body;
        if (!text || !color) return res.status(400).json({ error: 'Missing field' });

        const id = 'l' + Date.now();
        run('INSERT INTO labels (id, name, color) VALUES (?, ?, ?)', [id, text, color]);

        res.status(201).json({ id, text, color });
    } catch (err) {
        logger.error({ err: err.message, body: req.body }, 'Error adding label');
        res.status(500).json({ error: err.message });
    }
});

// Delete a label
router.delete('/:id', [auth, authorize(['admin'])], async (req, res) => {
    try {
        const { id } = req.params;

        transaction(() => {
            // Remove from junction table first to avoid FK issues
            run('DELETE FROM ticket_labels WHERE labelId = ?', [id]);
            // Then remove the label itself
            run('DELETE FROM labels WHERE id = ?', [id]);
        });

        // Broadcast to all clients so they can clean up their local state
        const io = req.app.get('io');
        if (io) {
            io.emit('label:deleted', { id });
        }

        res.status(204).end();
    } catch (err) {
        logger.error({ err: err.message, labelId: req.params.id }, 'Error deleting label');
        res.status(500).json({ error: err.message });
    }
});

export default router;
