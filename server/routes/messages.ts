import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import logger from '../utils/logger.js';
import { Message } from '../types/index.js';
import { auth } from '../middleware/auth.js';

const router = Router();

router.get('/', auth, async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.query;
    let sql = 'SELECT * FROM messages';
    const params: any[] = [];

    if (ticketId) {
      sql += ' WHERE ticket_id = $1';
      params.push(ticketId);
    }

    sql += ' ORDER BY created_at ASC';
    const messages = await query(sql, params) as any[];

    res.json(messages.map(m => ({
      ...m,
      whisper: !!m.whisper,
      system: !!m.system,
      reactions: JSON.parse(m.reactions || '{}')
    })));
  } catch (err: any) {
    logger.error({ err: err.message, query: req.query }, 'Error fetching messages');
    res.status(500).json({ error: err.message });
  }
});

export default router;
