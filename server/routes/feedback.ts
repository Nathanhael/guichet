import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, run } from '../db.js';
import logger from '../utils/logger.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validator.js';

const router = express.Router();

router.post('/', [
  body('userId').notEmpty().withMessage('User ID is required'),
  body('userName').notEmpty().withMessage('User Name is required'),
  body('role').isIn(['agent', 'expert']),
  body('text').notEmpty().trim().withMessage('Feedback text is required'),
  validate([])
], async (req: Request, res: Response) => {
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

    await run(
      'INSERT INTO app_feedback (id, user_id, user_name, role, text, treated, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [entry.id, entry.userId, entry.userName, entry.role, entry.text, entry.treated, entry.createdAt]
    );

    res.json(entry);
  } catch (err: any) {
    logger.error({ err: err.message, body: req.body }, 'Error submitting feedback');
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const feedback = await query('SELECT * FROM app_feedback ORDER BY created_at DESC') as any[];
    res.json(feedback.map(f => ({ ...f, treated: !!f.treated })));
  } catch (err: any) {
    logger.error({ err: err.message }, 'Error fetching feedback');
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/treat', async (req: Request, res: Response) => {
  try {
    const result = await run('UPDATE app_feedback SET treated = 1 WHERE id = $1', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Feedback not found' });

    const rows = await query('SELECT * FROM app_feedback WHERE id = $1', [req.params.id]);
    const fd = rows[0];
    res.json({ ...fd, treated: !!fd.treated });
  } catch (err: any) {
    logger.error({ err: err.message, feedbackId: req.params.id }, 'Error treating feedback');
    res.status(500).json({ error: err.message });
  }
});

export default router;
