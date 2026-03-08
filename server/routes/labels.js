import { Router } from 'express';
import { readDb, writeDb } from '../db.js';

const router = Router();

// Get all labels
router.get('/', async (req, res) => {
    try {
        const db = await readDb();
        res.json(db.labels || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add a new label
router.post('/', async (req, res) => {
    try {
        const { text, color } = req.body;
        if (!text || !color) return res.status(400).json({ error: 'Missing field' });

        const db = await readDb();
        if (!db.labels) db.labels = [];

        const newLabel = {
            id: 'l' + Date.now(),
            text,
            color
        };

        db.labels.push(newLabel);
        await writeDb(db);
        res.status(201).json(newLabel);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a label
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = await readDb();
        db.labels = (db.labels || []).filter(l => l.id !== id);
        await writeDb(db);
        res.status(204).end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
