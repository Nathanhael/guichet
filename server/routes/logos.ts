import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { fileTypeFromFile } from 'file-type';
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { auth, authorize, AuthRequest } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoDir = path.join(__dirname, '..', 'uploads', 'logos');

// Ensure directory exists
if (!fs.existsSync(logoDir)) {
  fs.mkdirSync(logoDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, logoDir),
  filename: (_req, file, cb) => {
    cb(null, `logo_${crypto.randomUUID()}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (config.UPLOAD_ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PNG, JPG and WEBP are allowed'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: config.UPLOAD_MAX_SIZE } });

const logoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many logo uploads. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post('/', auth, logoRateLimit, (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.user.isPlatformOperator) {
    return res.status(403).json({ error: 'Only platform operators can upload logos' });
  }

  upload.single('file')(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    if (!req.file) return res.status(400).json({ error: 'No file received' });

    try {
      const meta = await fileTypeFromFile(req.file.path);
      if (!meta || !config.UPLOAD_ALLOWED_TYPES.includes(meta.mime)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid file type' });
      }
    } catch (e) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Error validating file' });
    }

    const url = `/uploads/logos/${req.file.filename}`;
    res.json({ url });
  });
});

export default router;
