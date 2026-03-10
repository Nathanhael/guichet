import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run } from '../db.js';
import logger from '../utils/logger.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validator.js';

const router = express.Router();

// POST /api/feedback
router.post('/', [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('userName').notEmpty().withMessage('User Name is required'),
  body('role').isIn(['agent', 'expert']),
  body('text').notEmpty().trim().withMessage('Feedback text is required'),
  validate
], async (req, res) => {
  try {
    const { userId, userName, role, text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });

    const entry = {
      id: uuidv4(),
      userId,
      userName,
      role,
      text: text.trim(),
      treated: 0,
      createdAt: new Date().toISOString(),
    };

    run(
      'INSERT INTO app_feedback (id, userId, userName, role, text, treated, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [entry.id, entry.userId, entry.userName, entry.role, entry.text, entry.treated, entry.createdAt]
    );

    res.json(entry);
  } catch (err) {
    logger.error({ err: err.message, body: req.body }, 'Error submitting feedback');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedback
router.get('/', async (_req, res) => {
  try {
    const feedback = query('SELECT * FROM app_feedback ORDER BY createdAt DESC');
    res.json(feedback.map(f => ({ ...f, treated: !!f.treated })));
  } catch (err) {
    logger.error({ err: err.message }, 'Error fetching feedback');
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/feedback/:id/treat
router.patch('/:id/treat', async (req, res) => {
  try {
    const result = run('UPDATE app_feedback SET treated = 1 WHERE id = ?', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Feedback not found' });

    const fd = query('SELECT * FROM app_feedback WHERE id = ?', [req.params.id])[0];
    res.json({ ...fd, treated: !!fd.treated });
  } catch (err) {
    logger.error({ err: err.message, feedbackId: req.params.id }, 'Error treating feedback');
    res.status(500).json({ error: err.message });
  }
});

export default router;
