import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import config from '../config.js';
import { auth } from '../middleware/auth.js';
import { getStorage } from '../services/storage.js';

// HI-06 fix: Rate limit uploads to prevent abuse by authenticated users
const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per 15-minute window per user
  keyGenerator: (req: Request) => (req as Request & { user?: { id: string } }).user?.id || ipKeyGenerator(req.ip ?? 'unknown'),
  message: { error: 'Too many uploads — try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Global in-flight memory guard — reject uploads when too much RAM is buffered.
// Default cap: 100 MB across all concurrent uploads. Prevents OOM when many
// users upload simultaneously (especially with Azure backend latency).
const MAX_INFLIGHT_BYTES = 100 * 1024 * 1024;
let inflightBytes = 0;

function memoryGuard(req: Request, res: Response, next: () => void) {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  // Reject chunked uploads with no Content-Length — can't track memory accurately
  if (!req.headers['content-length']) {
    return res.status(411).json({ error: 'Content-Length required' });
  }
  if (inflightBytes + contentLength > MAX_INFLIGHT_BYTES) {
    return res.status(503).json({ error: 'Server busy — try again in a moment' });
  }
  inflightBytes += contentLength;
  // Release on finish OR close (client abort) — once-guard prevents double-decrement
  let released = false;
  const release = () => { if (!released) { released = true; inflightBytes -= contentLength; } };
  res.on('finish', release);
  res.on('close', release);
  next();
}

// Use memory storage — buffers are passed to the storage backend (local or Azure)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (config.UPLOAD_ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only images, PDF, Word, Excel, CSV and text files are allowed'));
    }
  },
  limits: { fileSize: config.UPLOAD_MAX_SIZE },
});

const router = Router();

router.post('/', auth, uploadRateLimit, memoryGuard, (req: Request, res: Response) => {
  upload.single('file')(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `File too large (max ${config.UPLOAD_MAX_SIZE / 1024 / 1024}MB)` });
      }
      return res.status(400).json({ error: (err as Error).message });
    } else if (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    if (!req.file) return res.status(400).json({ error: 'No file received' });

    try {
      const meta = await fileTypeFromBuffer(req.file.buffer);
      if (meta && !config.UPLOAD_ALLOWED_TYPES.includes(meta.mime)) {
        return res.status(400).json({ error: 'Invalid file type' });
      }
    } catch {
      return res.status(500).json({ error: 'Error validating file' });
    }

    const filename = `${crypto.randomUUID()}${path.extname(req.file.originalname)}`;
    const storage = getStorage();
    const url = await storage.upload(req.file.buffer, filename, req.file.mimetype);
    res.json({ url });
  });
});

router.post('/multi', auth, uploadRateLimit, memoryGuard, (req: Request, res: Response) => {
  const multiUpload = upload.array('files', 5);
  multiUpload(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large' });
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Too many files (max 5)' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: (err as Error).message });
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files received' });

    const storage = getStorage();
    const results: Array<{ url: string; name: string; mimeType: string; size: number }> = [];

    for (const file of files) {
      try {
        const detected = await fileTypeFromBuffer(file.buffer);
        if (detected && !config.UPLOAD_ALLOWED_TYPES.includes(detected.mime)) {
          continue; // Skip invalid files
        }
      } catch {
        continue;
      }

      const filename = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
      const url = await storage.upload(file.buffer, filename, file.mimetype);
      results.push({ url, name: file.originalname, mimeType: file.mimetype, size: file.size });
    }

    if (results.length === 0) return res.status(400).json({ error: 'No valid files' });
    return res.json(results);
  });
});

export default router;
