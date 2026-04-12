import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { auth } from '../middleware/auth.js';
import { getStorage } from '../services/storage.js';

// HI-06 fix: Rate limit uploads to prevent abuse by authenticated users
const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per 15-minute window per user
  keyGenerator: (req: Request) => (req as Request & { user?: { id: string } }).user?.id || req.ip || 'unknown',
  message: { error: 'Too many uploads — try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

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

router.post('/', auth, uploadRateLimit, (req: Request, res: Response) => {
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

router.post('/multi', auth, uploadRateLimit, (req: Request, res: Response) => {
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
