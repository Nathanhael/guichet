import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { fileTypeFromFile } from 'file-type';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { auth } from '../middleware/auth.js';

// HI-06 fix: Rate limit uploads to prevent disk exhaustion by authenticated users
const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per 15-minute window per user
  keyGenerator: (req: Request) => (req as Request & { user?: { id: string } }).user?.id || req.ip || 'unknown',
  message: { error: 'Too many uploads — try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (config.UPLOAD_ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only images, PDF, Word, Excel, CSV and text files are allowed'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: config.UPLOAD_MAX_SIZE } });

const router = Router();

router.post('/', auth, uploadRateLimit, (req: Request, res: Response) => {
  upload.single('file')(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Bestand te groot (max ${config.UPLOAD_MAX_SIZE / 1024 / 1024}MB)` });
      }
      return res.status(400).json({ error: (err as Error).message });
    } else if (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    if (!req.file) return res.status(400).json({ error: 'Geen bestand ontvangen' });

    try {
      const meta = await fileTypeFromFile(req.file.path);
      if (!meta || !config.UPLOAD_ALLOWED_TYPES.includes(meta.mime)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Ongeldig bestandstype' });
      }
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Fout bij het controleren van het bestand' });
    }

    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  });
});

router.post('/multi', auth, uploadRateLimit, (req: Request, res: Response) => {
  const multiUpload = multer({ storage, fileFilter, limits: { fileSize: config.UPLOAD_MAX_SIZE } }).array('files', 5);
  multiUpload(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large' });
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Too many files (max 5)' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: (err as Error).message });
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files received' });
    const results: Array<{ url: string; name: string; mimeType: string; size: number }> = [];
    for (const file of files) {
      try {
        const detected = await fileTypeFromFile(file.path);
        if (detected && !config.UPLOAD_ALLOWED_TYPES.includes(detected.mime)) {
          fs.unlinkSync(file.path);
          continue;
        }
      } catch {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        continue;
      }
      results.push({
        url: `/uploads/${file.filename}`,
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      });
    }
    if (results.length === 0) return res.status(400).json({ error: 'No valid files' });
    return res.json(results);
  });
});

export default router;
