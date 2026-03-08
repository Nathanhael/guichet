import { Router } from 'express';
import { readDb } from '../db.js';

const router = Router();

// GET /api/messages?ticketId=...
router.get('/', async (req, res) => {
  try {
    const db = await readDb();
    const { ticketId } = req.query;
    const messages = ticketId
      ? db.messages.filter((m) => m.ticketId === ticketId)
      : db.messages;
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
