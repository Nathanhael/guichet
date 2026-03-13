import express, { Response } from 'express';
import { query } from '../db.js';
import logger from '../utils/logger.js';
import { query as queryVal } from 'express-validator';
import { validate } from '../middleware/validator.js';
import { Ticket } from '../types/index.js';
import { auth, authorize, AuthRequest } from '../middleware/auth.js';

const router = express.Router();

/**
 * LEGACY EXPORT ROUTE
 * Kept because tRPC is not ideal for direct binary/CSV downloads in browser windows.
 */
router.get('/export', [
  auth,
  authorize(['admin', 'expert']),
  queryVal('dept').optional().isString(),
  queryVal('search').optional().isString(),
  queryVal('dateFrom').optional().isISO8601(),
  queryVal('dateTo').optional().isISO8601(),
  validate([])
], async (req: AuthRequest, res: Response) => {
  try {
    const { dept, search, dateFrom, dateTo } = req.query as any;

    let sql = "SELECT * FROM tickets WHERE status = 'closed'";
    const params: any[] = [];
    let pIdx = 1;

    if (dept && dept !== 'all') {
      sql += ` AND dept = $${pIdx}`;
      params.push(dept);
      pIdx++;
    }
    if (search) {
      const q = `%${search}%`;
      sql += ` AND (agent_name ILIKE $${pIdx} OR cdb_id ILIKE $${pIdx} OR dare_ref ILIKE $${pIdx} OR expert_name ILIKE $${pIdx})`;
      params.push(q);
      pIdx++;
    }
    if (dateFrom) {
      sql += ` AND created_at >= $${pIdx}`;
      params.push(dateFrom);
      pIdx++;
    }
    if (dateTo) {
      const end = dateTo + 'T23:59:59';
      sql += ` AND created_at <= $${pIdx}`;
      params.push(end);
      pIdx++;
    }

    sql += ' ORDER BY closed_at DESC';

    const result = await query(sql, params) as Ticket[];
    
    // Format as CSV
    const headers = ['ID', 'Department', 'Agent', 'CDBID', 'Dare Ref', 'Expert', 'Created At', 'Closed At', 'Status'];
    const rows = result.map(t => [
      t.id,
      t.dept,
      t.agentName,
      t.cdbId || '',
      t.dareRef || '',
      t.expertName || '',
      t.createdAt,
      t.closedAt || '',
      t.status
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=tickets_export_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csvContent);

  } catch (err: any) {
    logger.error({ err: err.message, query: req.query }, 'Error exporting tickets');
    res.status(500).json({ error: err.message });
  }
});

/**
 * LEGACY MESSAGES ROUTE
 * Kept temporarily for components that might still fetch via REST (e.g. specialized previews)
 */
router.get('/:id/messages', auth, async (req: any, res: Response) => {
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
