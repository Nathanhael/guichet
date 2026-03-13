import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { fileTypeFromFile } from 'file-type';
import config from '../config.js';
import { auth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (config.UPLOAD_ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Alleen PNG, JPG en WEBP zijn toegestaan'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: config.UPLOAD_MAX_SIZE } });

const router = Router();

router.post('/', auth, (req: Request, res: Response) => {
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

export default router;
