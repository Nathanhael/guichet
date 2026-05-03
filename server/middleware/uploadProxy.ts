// server/middleware/uploadProxy.ts
//
// Tenant-isolation gate on the `/uploads/<filename>` proxy. Three checks fire
// in order:
//   1. JWT cookie present + valid signature.
//   2. Filename normalizes to a safe path (no traversal, no NULs, no `..`).
//   3. Filename is registered in `messages.attachments` (or legacy `mediaUrl`)
//      AND that message belongs to the caller`s partner.
//
// Outcomes:
//   • Missing/invalid JWT          → 401
//   • Path traversal attempt       → 400
//   • Filename not in any message  → 404 (don`t leak existence elsewhere)
//   • Filename owned by other tenant → 403
//   • Match → stream buffer from storage
//
// Platform operators carry a partner-scoped JWT after `/enter-partner`, so the
// same check works for them transparently — no special branch.
import path from 'path';
import { jwtVerify } from 'jose';
import { Request, Response } from 'express';
import config from '../config.js';
import { jwtPayloadSchema } from '../trpc/context.js';
import { getStorage } from '../services/storage.js';
import { lookupFilePartnerId } from '../services/uploadOwnership.js';

const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);

const mimeMap: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function uploadProxyHandler(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.guichet_token;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let callerPartnerId: string | undefined;
  try {
    const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] });
    const decoded = jwtPayloadSchema.parse(payload);
    callerPartnerId = decoded.partnerId;
  } catch {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const raw = req.path.replace(/^\//, '');
  const filePath = path.posix.normalize(raw);
  if (
    !filePath ||
    filePath.startsWith('..') ||
    filePath.includes('/../') ||
    filePath.includes('\\') ||
    filePath.includes('\0')
  ) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const ownerPartnerId = await lookupFilePartnerId(filePath);
  if (ownerPartnerId === null) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  if (!callerPartnerId || ownerPartnerId !== callerPartnerId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const storage = getStorage();
    const buffer = await storage.read(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
}
