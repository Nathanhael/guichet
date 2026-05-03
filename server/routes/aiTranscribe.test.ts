import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── State controlled per-test ──────────────────────────────────────────────
let authState: { authenticated: boolean; partnerId?: string; userId?: string } = {
  authenticated: true,
  partnerId: 'tenant-a',
  userId: 'user-1',
};
let voiceEnabled = true;
let providerOverride: { transcribe?: ((p: any) => Promise<{ transcript: string; durationSeconds?: number }>) | undefined; name: string } | null = null;
let userLang: string | null = 'en';

const logUsageMock = vi.fn();

// ── Mocks (must be hoisted; vi.mock calls hoist automatically) ────────────
vi.mock('../middleware/auth.js', () => ({
  auth: (req: any, res: any, next: any) => {
    if (!authState.authenticated) {
      return res.status(401).json({ error: 'No token provided' });
    }
    req.user = {
      id: authState.userId,
      role: 'support',
      isPlatformOperator: false,
      partnerId: authState.partnerId,
    };
    next();
  },
}));

vi.mock('../services/ai/index.js', () => ({
  isFeatureEnabled: vi.fn(async (_pid: string, feature: string) => {
    if (feature === 'voiceTranscription') return voiceEnabled;
    return false;
  }),
  getProvider: vi.fn(async () => {
    if (providerOverride === null) {
      return {
        name: 'azure-openai',
        transcribe: vi.fn(async (_p: any) => ({ transcript: 'hello there', durationSeconds: 1.5 })),
      };
    }
    return providerOverride;
  }),
  logUsage: logUsageMock,
}));

vi.mock('../db.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (userLang === null ? [] : [{ lang: userLang }]),
        }),
      }),
    }),
  },
}));

vi.mock('../db/schema.js', () => ({
  users: { id: 'id', lang: 'lang' },
}));

vi.mock('../utils/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────
async function buildApp() {
  const { default: aiTranscribeRoutes } = await import('./aiTranscribe.js');
  const app = express();
  app.use(aiTranscribeRoutes);
  return app;
}

describe('POST /transcribe', () => {
  beforeEach(() => {
    authState = { authenticated: true, partnerId: 'tenant-a', userId: 'user-1' };
    voiceEnabled = true;
    providerOverride = null;
    userLang = 'en';
    logUsageMock.mockReset();
    vi.resetModules();
  });

  it('returns 401 when no auth', async () => {
    authState = { authenticated: false };
    const app = await buildApp();
    const res = await request(app).post('/transcribe');
    expect(res.status).toBe(401);
  });

  it('returns 400 when no audio file uploaded', async () => {
    const app = await buildApp();
    const res = await request(app).post('/transcribe');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no audio/i);
  });

  it('returns 403 when partner has voiceTranscription disabled', async () => {
    voiceEnabled = false;
    const app = await buildApp();
    const res = await request(app)
      .post('/transcribe')
      .attach('audio', Buffer.from('fake-audio'), { filename: 'rec.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(403);
  });

  it('returns 415 for disallowed mime type', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/transcribe')
      .attach('audio', Buffer.from('not-audio'), { filename: 'data.bin', contentType: 'application/octet-stream' });
    expect(res.status).toBe(415);
  });

  it('returns 413 when file > 5MB', async () => {
    const app = await buildApp();
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    const res = await request(app)
      .post('/transcribe')
      .attach('audio', oversized, { filename: 'big.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(413);
  });

  it('returns 200 + transcript on happy path', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/transcribe')
      .attach('audio', Buffer.from('hello'), { filename: 'rec.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ transcript: 'hello there' });
  });

  it('passes user.lang as languageHint to provider', async () => {
    userLang = 'fr';
    const transcribeFn = vi.fn(async () => ({ transcript: 'bonjour', durationSeconds: 1 }));
    providerOverride = { name: 'azure-openai', transcribe: transcribeFn };

    const app = await buildApp();
    await request(app)
      .post('/transcribe')
      .attach('audio', Buffer.from('hi'), { filename: 'rec.webm', contentType: 'audio/webm' });

    expect(transcribeFn).toHaveBeenCalledWith(
      expect.objectContaining({ languageHint: 'fr', mimeType: 'audio/webm' }),
    );
  });

  it('logs usage with action=transcribe on success', async () => {
    const app = await buildApp();
    await request(app)
      .post('/transcribe')
      .attach('audio', Buffer.from('hi'), { filename: 'rec.webm', contentType: 'audio/webm' });

    expect(logUsageMock).toHaveBeenCalledTimes(1);
    expect(logUsageMock.mock.calls[0][0]).toMatchObject({
      partnerId: 'tenant-a',
      userId: 'user-1',
      action: 'transcribe',
      provider: 'azure-openai',
      success: true,
    });
  });

  it('returns 501 when provider has no transcribe method', async () => {
    providerOverride = { name: 'openai-compatible', transcribe: undefined };
    const app = await buildApp();
    const res = await request(app)
      .post('/transcribe')
      .attach('audio', Buffer.from('hi'), { filename: 'rec.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(501);
  });

  it('returns 502 when provider throws', async () => {
    providerOverride = {
      name: 'azure-openai',
      transcribe: vi.fn(async () => {
        throw new Error('Whisper transcription failed: 500: oops');
      }),
    };
    const app = await buildApp();
    const res = await request(app)
      .post('/transcribe')
      .attach('audio', Buffer.from('hi'), { filename: 'rec.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(502);
  });

  it('returns 400 when partnerId missing from JWT', async () => {
    authState = { authenticated: true, userId: 'user-1', partnerId: undefined };
    const app = await buildApp();
    const res = await request(app)
      .post('/transcribe')
      .attach('audio', Buffer.from('hi'), { filename: 'rec.webm', contentType: 'audio/webm' });
    expect(res.status).toBe(400);
  });
});
