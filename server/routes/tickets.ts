import express, { Request, Response } from 'express';
import { eq, and, ilike, gte, lte, or, desc, type SQL } from 'drizzle-orm';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { db } from '../db/postgres.js';
import { tickets } from '../db/schema.js';
import logger from '../utils/logger.js';
import { z } from 'zod';
import { validateQuery } from '../middleware/validator.js';
import { auth, authorize, AuthRequest } from '../middleware/auth.js';
import { canExportTickets } from '../services/roles.js';
import { escapeLikePattern } from '../utils/security.js';

const exportRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 exports per 15-minute window per user
  keyGenerator: (req: Request) => (req as Request & { user?: { id: string } }).user?.id || ipKeyGenerator(req.ip ?? 'unknown'),
  message: { error: 'Too many export requests — try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = express.Router();

/**
 * BINARY EXPORT ROUTE
 * Express (not tRPC) because tRPC is not ideal for direct binary/CSV downloads
 * in browser windows.
 */
router.get('/export', auth, authorize(['admin', 'support']), exportRateLimit, validateQuery(z.object({
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

    const conditions: SQL[] = [
      eq(tickets.status, 'closed'),
      eq(tickets.partnerId, partnerId),
    ];

    if (dept && dept !== 'all') {
      conditions.push(eq(tickets.dept, dept));
    }

    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      conditions.push(
        or(
          ilike(tickets.agentName, pattern),
          ilike(tickets.supportName, pattern),
        )!,
      );
    }

    if (dateFrom) {
      conditions.push(gte(tickets.createdAt, dateFrom));
    }

    if (dateTo) {
      const end = dateTo + 'T23:59:59';
      conditions.push(lte(tickets.createdAt, end));
    }

    const result = await db
      .select()
      .from(tickets)
      .where(and(...conditions))
      .orderBy(desc(tickets.closedAt))
      .limit(10000);
    
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
