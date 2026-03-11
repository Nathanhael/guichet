import express, { Request, Response } from 'express';
import { query, get } from '../db.js';
import logger from '../utils/logger.js';
import { query as queryVal } from 'express-validator';
import { validate } from '../middleware/validator.js';
import { Ticket } from '../types/index.js';

const router = express.Router();

router.get('/', [
  queryVal('status').optional().isIn(['open', 'pending', 'closed']),
  queryVal('dept').optional().isString(),
  queryVal('dateFrom').optional().isISO8601(),
  queryVal('dateTo').optional().isISO8601(),
  queryVal('limit').optional().isInt({ min: 1 }),
  queryVal('offset').optional().isInt({ min: 0 }),
  validate([])
], async (req: Request, res: Response) => {
  try {
    const { agentId, status, dept, search, limit, offset, dateFrom, dateTo } = req.query as any;

    let sql = 'SELECT * FROM tickets WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM tickets WHERE 1=1';
    const params: any[] = [];
    let pIdx = 1;

    if (agentId) {
      sql += ` AND agent_id = $${pIdx}`;
      countSql += ` AND agent_id = $${pIdx}`;
      params.push(agentId);
      pIdx++;
    }
    if (status) {
      sql += ` AND status = $${pIdx}`;
      countSql += ` AND status = $${pIdx}`;
      params.push(status);
      pIdx++;
    }
    if (dept && dept !== 'all') {
      sql += ` AND dept = $${pIdx}`;
      countSql += ` AND dept = $${pIdx}`;
      params.push(dept);
      pIdx++;
    }
    if (search) {
      const q = `%${search}%`;
      const searchClause = ` AND (agent_name ILIKE $${pIdx} OR cdb_id ILIKE $${pIdx} OR dare_ref ILIKE $${pIdx} OR expert_name ILIKE $${pIdx})`;
      sql += searchClause;
      countSql += searchClause;
      params.push(q);
      pIdx++;
    }
    if (dateFrom) {
      sql += ` AND created_at >= $${pIdx}`;
      countSql += ` AND created_at >= $${pIdx}`;
      params.push(dateFrom);
      pIdx++;
    }
    if (dateTo) {
      const end = dateTo + 'T23:59:59';
      sql += ` AND created_at <= $${pIdx}`;
      countSql += ` AND created_at <= $${pIdx}`;
      params.push(end);
      pIdx++;
    }

    if (status === 'closed') {
      sql += ' ORDER BY closed_at DESC';
    } else {
      sql += ' ORDER BY created_at ASC';
    }

    if (limit !== undefined) {
      const countRes = await get(countSql, params);
      const totalCount = countRes ? countRes.total : 0;
      
      sql += ` LIMIT $${pIdx} OFFSET $${pIdx + 1}`;
      const result = await query(sql, [...params, parseInt(limit), parseInt(offset) || 0]) as Ticket[];

      const tickets = await Promise.all(result.map(async t => ({
        ...t,
        participants: JSON.parse(t.participants || '[]'),
        labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [t.id])).map((l: any) => l.labelId)
      })));

      return res.json({ tickets, total: totalCount });
    }

    const result = await query(sql, params) as Ticket[];
    const tickets = await Promise.all(result.map(async t => ({
      ...t,
      participants: JSON.parse(t.participants || '[]'),
      labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [t.id])).map((l: any) => l.labelId)
    })));

    res.json(tickets);
  } catch (err: any) {
    logger.error({ err: err.message, query: req.query }, 'Error fetching tickets');
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const messages = await query('SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC', [req.params.id]) as any[];
    res.json(messages.map(m => ({
      ...m,
      whisper: !!m.whisper,
      system: !!m.system
    })));
  } catch (err: any) {
    logger.error({ err: err.message, params: req.params }, 'Error fetching messages');
    res.status(500).json({ error: err.message });
  }
});

export default router;
