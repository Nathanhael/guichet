import { Router } from 'express';
import { readDb } from '../db.js';

const router = Router();

// GET /api/tickets — all tickets (for manager/expert)
// Supports: agentId, status, dept, search, limit, offset
// When limit is provided, returns { tickets, total } instead of array
router.get('/', async (req, res) => {
  try {
    const db = await readDb();
    const { agentId, status, dept, search, limit, offset, dateFrom, dateTo } = req.query;
    let tickets = db.tickets;

    if (agentId) tickets = tickets.filter((t) => t.agentId === agentId);
    if (status) tickets = tickets.filter((t) => t.status === status);
    if (dept && dept !== 'all') tickets = tickets.filter((t) => t.dept === dept);
    if (search) {
      const q = search.toLowerCase();
      tickets = tickets.filter((t) =>
        t.agentName?.toLowerCase().includes(q) ||
        t.cdbId?.toLowerCase().includes(q) ||
        t.dareRef?.toLowerCase().includes(q) ||
        t.expertName?.toLowerCase().includes(q)
      );
    }
    if (dateFrom) tickets = tickets.filter((t) => t.createdAt >= dateFrom);
    if (dateTo)   tickets = tickets.filter((t) => t.createdAt <= dateTo + 'T23:59:59');

    // Sort closed tickets newest-first
    if (status === 'closed') {
      tickets = [...tickets].sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));
    }

    if (limit !== undefined) {
      const total = tickets.length;
      const start = parseInt(offset) || 0;
      const end = start + parseInt(limit);
      return res.json({ tickets: tickets.slice(start, end), total });
    }

    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/:id/messages
router.get('/:id/messages', async (req, res) => {
  try {
    const db = await readDb();
    const messages = db.messages.filter((m) => m.ticketId === req.params.id);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
