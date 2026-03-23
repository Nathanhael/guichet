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
  authorize(['admin', 'support']),
  queryVal('dept').optional().isString(),
  queryVal('search').optional().isString(),
  queryVal('dateFrom').optional().isISO8601(),
  queryVal('dateTo').optional().isISO8601(),
  validate([])
], async (req: AuthRequest, res: Response) => {
  try {
    const { dept, search, dateFrom, dateTo } = req.query as { dept?: string; search?: string; dateFrom?: string; dateTo?: string };

    let sql = "SELECT * FROM tickets WHERE status = 'closed'";
    const params: unknown[] = [];
    let pIdx = 1;

    if (dept && dept !== 'all') {
      sql += ` AND dept = $${pIdx}`;
      params.push(dept);
      pIdx++;
    }
    if (search) {
      const q = `%${search}%`;
      sql += ` AND (agent_name ILIKE $${pIdx} OR support_name ILIKE $${pIdx})`;
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

    const result = (await query(sql, params)) as unknown as Ticket[];
    
    // Format as CSV
    const headers = ['ID', 'Department', 'Agent', 'References', 'Support', 'Created At', 'Closed At', 'Status'];
    const rows = result.map(t => {
      let parsedRefs: Array<{ label: string; value: string }> = [];
      try {
        const raw = (t as any).references;
        parsedRefs = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []) || [];
      } catch { /* malformed JSON — skip */ }
      const refsStr = parsedRefs.map(r => `${r.label}: ${r.value}`).join('; ');
      return [
      t.id,
      t.dept,
      t.agentName,
      refsStr,
      t.supportName || '',
      t.createdAt,
      t.closedAt || '',
      t.status
    ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=tickets_export_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csvContent);

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg, query: req.query }, 'Error exporting tickets');
    res.status(500).json({ error: errMsg });
  }
});

export default router;
