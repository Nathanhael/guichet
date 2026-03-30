import express, { Response } from 'express';
import { query } from '../db.js';
import logger from '../utils/logger.js';
import { z } from 'zod';
import { validateQuery } from '../middleware/validator.js';
import { Ticket } from '../types/index.js';
import { auth, authorize, AuthRequest } from '../middleware/auth.js';
import { canExportTickets } from '../services/roles.js';
import { escapeLikePattern } from '../utils/security.js';

const router = express.Router();

/**
 * LEGACY EXPORT ROUTE
 * Kept because tRPC is not ideal for direct binary/CSV downloads in browser windows.
 */
router.get('/export', auth, authorize(['admin', 'support']), validateQuery(z.object({
  partnerId: z.string().optional(),
  dept: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid ISO 8601 date').optional(),
  dateTo: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid ISO 8601 date').optional(),
}).passthrough()), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || !canExportTickets(req.user.role, req.user.isPlatformOperator)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Platform operators may specify any partnerId; all others use their own
    const requestedPartnerId = req.query.partnerId as string | undefined;
    const partnerId = req.user.isPlatformOperator
      ? (requestedPartnerId || req.user.partnerId)
      : req.user.partnerId;

    if (!partnerId) {
      return res.status(400).json({ error: 'partnerId is required' });
    }

    // Non-platform users cannot export from other tenants
    if (!req.user.isPlatformOperator && requestedPartnerId && requestedPartnerId !== req.user.partnerId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { dept, search, dateFrom, dateTo } = req.query as { dept?: string; search?: string; dateFrom?: string; dateTo?: string };

    let sql = "SELECT * FROM tickets WHERE status = 'closed'";
    const params: unknown[] = [];
    let pIdx = 1;

    sql += ` AND partner_id = $${pIdx}`;
    params.push(partnerId);
    pIdx++;

    if (dept && dept !== 'all') {
      sql += ` AND dept = $${pIdx}`;
      params.push(dept);
      pIdx++;
    }
    if (search) {
      const q = `%${escapeLikePattern(search)}%`;
      sql += ` AND (agent_name ILIKE $${pIdx} ESCAPE '\\' OR support_name ILIKE $${pIdx} ESCAPE '\\')`;
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

    sql += ' ORDER BY closed_at DESC LIMIT 10000';

    const result = (await query(sql, params)) as unknown as Ticket[];
    
    // Format as CSV
    const headers = ['ID', 'Department', 'Agent', 'References', 'Support', 'Created At', 'Closed At', 'Status'];
    const rows = result.map(t => {
      let parsedRefs: Array<{ label: string; value: string }> = [];
      try {
        const raw = t.references;
        parsedRefs = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []) || [];
      } catch { logger.warn({ raw: t.references }, 'Malformed JSON in ticket participants'); }
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
      ...rows.map(row => row.map(cell => {
        let val = String(cell || '').replace(/"/g, '""');
        // Prevent CSV formula injection in spreadsheet applications
        if (/^[=+\-@\t\r]/.test(val)) val = "'" + val;
        return `"${val}"`;
      }).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=tickets_export_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csvContent);

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg, query: req.query }, 'Ticket export failed');
    res.status(500).json({ error: 'Server error processing request' });
  }
});

export default router;
