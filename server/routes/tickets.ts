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
      sql += ` AND "agentId" = $${pIdx}`;
      countSql += ` AND "agentId" = $${pIdx}`;
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
      const searchClause = ` AND ("agentName" ILIKE $${pIdx} OR "cdbId" ILIKE $${pIdx} OR "dareRef" ILIKE $${pIdx} OR "expertName" ILIKE $${pIdx})`;
      sql += searchClause;
      countSql += searchClause;
      params.push(q);
      pIdx++;
    }
    if (dateFrom) {
      sql += ` AND "createdAt" >= $${pIdx}`;
      countSql += ` AND "createdAt" >= $${pIdx}`;
      params.push(dateFrom);
      pIdx++;
    }
    if (dateTo) {
      const end = dateTo + 'T23:59:59';
      sql += ` AND "createdAt" <= $${pIdx}`;
      countSql += ` AND "createdAt" <= $${pIdx}`;
      params.push(end);
      pIdx++;
    }

    if (status === 'closed') {
      sql += ' ORDER BY "closedAt" DESC';
    } else {
      sql += ' ORDER BY "createdAt" ASC';
    }

    if (limit !== undefined) {
      const countRes = await get(countSql, params);
      const totalCount = countRes ? countRes.total : 0;
      
      sql += ` LIMIT $${pIdx} OFFSET $${pIdx + 1}`;
      const result = await query(sql, [...params, parseInt(limit), parseInt(offset) || 0]) as Ticket[];

      const tickets = await Promise.all(result.map(async t => ({
        ...t,
        participants: JSON.parse(t.participants || '[]'),
        labels: (await query('SELECT "labelId" FROM ticket_labels WHERE "ticketId" = $1', [t.id])).map((l: any) => l.labelId)
      })));

      return res.json({ tickets, total: totalCount });
    }

    const result = await query(sql, params) as Ticket[];
    const tickets = await Promise.all(result.map(async t => ({
      ...t,
      participants: JSON.parse(t.participants || '[]'),
      labels: (await query('SELECT "labelId" FROM ticket_labels WHERE "ticketId" = $1', [t.id])).map((l: any) => l.labelId)
    })));

    res.json(tickets);
  } catch (err: any) {
    logger.error({ err: err.message, query: req.query }, 'Error fetching tickets');
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const messages = await query('SELECT * FROM messages WHERE "ticketId" = $1 ORDER BY "createdAt" ASC', [req.params.id]) as any[];
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
