import express from 'express';
import { query, get } from '../db.js';
import logger from '../utils/logger.js';
import { query as queryVal } from 'express-validator';
import { validate } from '../middleware/validator.js';

const router = express.Router();

// GET /api/tickets — all tickets (for manager/expert)
router.get('/', [
  queryVal('status').optional().isIn(['open', 'pending', 'closed']),
  queryVal('dept').optional().isString(),
  queryVal('dateFrom').optional().isISO8601(),
  queryVal('dateTo').optional().isISO8601(),
  queryVal('limit').optional().isInt({ min: 1 }),
  queryVal('offset').optional().isInt({ min: 0 }),
  validate
], async (req, res) => {
  try {
    const { agentId, status, dept, search, limit, offset, dateFrom, dateTo } = req.query;

    let sql = 'SELECT * FROM tickets WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM tickets WHERE 1=1';
    const params = [];

    if (agentId) {
      sql += ' AND agentId = ?';
      countSql += ' AND agentId = ?';
      params.push(agentId);
    }
    if (status) {
      sql += ' AND status = ?';
      countSql += ' AND status = ?';
      params.push(status);
    }
    if (dept && dept !== 'all') {
      sql += ' AND dept = ?';
      countSql += ' AND dept = ?';
      params.push(dept);
    }
    if (search) {
      const q = `%${search}%`;
      const searchClause = ' AND (agentName LIKE ? OR cdbId LIKE ? OR dareRef LIKE ? OR expertName LIKE ?)';
      sql += searchClause;
      countSql += searchClause;
      params.push(q, q, q, q);
    }
    if (dateFrom) {
      sql += ' AND createdAt >= ?';
      countSql += ' AND createdAt >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      const end = dateTo + 'T23:59:59';
      sql += ' AND createdAt <= ?';
      countSql += ' AND createdAt <= ?';
      params.push(end);
    }

    // Sorting
    if (status === 'closed') {
      sql += ' ORDER BY closedAt DESC';
    } else {
      sql += ' ORDER BY createdAt ASC';
    }

    if (limit !== undefined) {
      const total = get(countSql, params).total;
      sql += ' LIMIT ? OFFSET ?';
      const result = query(sql, [...params, parseInt(limit), parseInt(offset) || 0]);

      // Map participants and labels (Legacy support/Frontend expects objects)
      const tickets = result.map(t => ({
        ...t,
        participants: JSON.parse(t.participants || '[]'),
        labels: query('SELECT labelId FROM ticket_labels WHERE ticketId = ?', [t.id]).map(l => l.labelId)
      }));

      return res.json({ tickets, total });
    }

    const result = query(sql, params);
    const tickets = result.map(t => ({
      ...t,
      participants: JSON.parse(t.participants || '[]'),
      labels: query('SELECT labelId FROM ticket_labels WHERE ticketId = ?', [t.id]).map(l => l.labelId)
    }));

    res.json(tickets);
  } catch (err) {
    logger.error({ err: err.message, query: req.query }, 'Error fetching tickets');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/:id/messages
router.get('/:id/messages', async (req, res) => {
  try {
    const messages = query('SELECT * FROM messages WHERE ticketId = ? ORDER BY createdAt ASC', [req.params.id]);
    res.json(messages.map(m => ({
      ...m,
      whisper: !!m.whisper,
      system: !!m.system
    })));
  } catch (err) {
    logger.error({ err: err.message, query: req.query }, 'Error fetching tickets');
    res.status(500).json({ error: err.message });
  }
});

export default router;
