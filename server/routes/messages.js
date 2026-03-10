import { Router } from 'express';
import { query } from '../db.js';
import logger from '../utils/logger.js';

const router = Router();

// GET /api/messages?ticketId=...
router.get('/', async (req, res) => {
  try {
    const { ticketId } = req.query;
    let sql = 'SELECT * FROM messages';
    const params = [];

    if (ticketId) {
      sql += ' WHERE ticketId = ?';
      params.push(ticketId);
    }

    sql += ' ORDER BY createdAt ASC';
    const messages = query(sql, params);

    res.json(messages.map(m => ({
      ...m,
      whisper: !!m.whisper,
      system: !!m.system
    })));
  } catch (err) {
    logger.error({ err: err.message, query: req.query }, 'Error fetching messages');
    res.status(500).json({ error: err.message });
  }
});

export default router;
