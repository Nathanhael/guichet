import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { readDb, writeDb } from '../db.js';

const router = Router();

// POST /api/feedback
router.post('/', async (req, res) => {
  try {
    const { userId, userName, role, text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

    const db = await readDb();
    const entry = {
      id: uuidv4(),
      userId,
      userName,
      role,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    db.feedback.push(entry);
    await writeDb(db);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback
router.get('/', async (_req, res) => {
  try {
    const db = await readDb();
    res.json(db.feedback || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/feedback/:id/treat
router.patch('/:id/treat', async (req, res) => {
  try {
    const db = await readDb();
    const fd = db.feedback.find(f => f.id === req.params.id);
    if (!fd) return res.status(404).json({ error: 'Feedback not found' });

    fd.treated = true;
    await writeDb(db);
    res.json(fd);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
