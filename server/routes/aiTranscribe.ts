import { Router, Response } from 'express';
import multer from 'multer';
import { eq } from 'drizzle-orm';
import { auth, AuthRequest } from '../middleware/auth.js';
import { db } from '../db.js';
import * as schema from '../db/schema.js';
import logger from '../utils/logger.js';
import { getProvider, isFeatureEnabled, logUsage } from '../services/ai/index.js';

// Whisper hard caps (spec decision 9): 60s + 5MB on both client and server.
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Set<string>([
  'audio/webm',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/x-m4a',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

type UserLang = 'nl' | 'fr' | 'en';
function coerceLang(raw: unknown): UserLang | undefined {
  if (raw === 'nl' || raw === 'fr' || raw === 'en') return raw;
  return undefined;
}

const router = Router();

router.post('/transcribe', auth, (req: AuthRequest, res: Response) => {
  upload.single('audio')(req, res, async (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Audio too large (max ${MAX_BYTES / 1024 / 1024}MB)` });
      }
      return res.status(400).json({ error: (err as Error).message });
    }
    if (err) {
      return res.status(400).json({ error: (err as Error).message });
    }

    const partnerId = req.user?.partnerId;
    const userId = req.user?.id;
    if (!partnerId || !userId) {
      return res.status(400).json({ error: 'Missing partner context' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      return res.status(415).json({ error: `Unsupported audio type: ${req.file.mimetype}` });
    }

    // Per-partner feature gate (slice 4: voiceTranscription).
    const enabled = await isFeatureEnabled(partnerId, 'voiceTranscription');
    if (!enabled) {
      return res.status(403).json({ error: 'Voice transcription not enabled for this partner' });
    }

    // Resolve language hint from user.lang (spec decision 10).
    let languageHint: UserLang | undefined;
    try {
      const rows = await (db as any).select({ lang: schema.users.lang })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      languageHint = coerceLang(rows?.[0]?.lang);
    } catch {
      languageHint = undefined;
    }

    const provider = await getProvider(partnerId);
    if (typeof provider.transcribe !== 'function') {
      return res.status(501).json({ error: 'Transcription not supported by current AI provider' });
    }

    const start = Date.now();
    let result: Awaited<ReturnType<NonNullable<typeof provider.transcribe>>>;
    try {
      result = await provider.transcribe({
        audio: req.file.buffer,
        mimeType: req.file.mimetype,
        languageHint,
      });
    } catch (provErr) {
      logger.error(
        { err: provErr instanceof Error ? provErr.message : String(provErr), partnerId },
        '[ai] transcribe provider error',
      );
      try {
        await logUsage({
          partnerId,
          userId,
          action: 'transcribe' as any,
          provider: provider.name,
          model: 'whisper',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - start,
          success: false,
          errorMessage: provErr instanceof Error ? provErr.message : String(provErr),
        });
      } catch { /* logUsage swallows internally; ignore */ }
      return res.status(502).json({ error: 'Transcription failed' });
    }

    try {
      await logUsage({
        partnerId,
        userId,
        action: 'transcribe' as any,
        provider: provider.name,
        model: 'whisper',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - start,
        success: true,
      });
    } catch { /* non-fatal */ }

    return res.json({ transcript: result.transcript });
  });
});

export default router;
