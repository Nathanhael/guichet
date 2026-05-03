// server/routes/uploads.test.ts
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Auth bypass — every test acts as an authenticated agent.
vi.mock('../middleware/auth.js', () => ({
  auth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: 'u1', role: 'agent', partnerId: 'partner-acme', isPlatformOperator: false };
    next();
  },
}));

// Capture what the route hands to storage.
const storageUploadMock = vi.fn(async (_buf: Buffer, filename: string, _mime: string) => `/uploads/${filename}`);
vi.mock('../services/storage.js', () => ({
  getStorage: () => ({
    upload: storageUploadMock,
    delete: vi.fn(),
    getUrl: vi.fn(),
    read: vi.fn(),
    healthy: vi.fn(),
  }),
}));

vi.mock('../config.js', () => ({
  default: {
    UPLOAD_MAX_SIZE: 10 * 1024 * 1024,
    UPLOAD_ALLOWED_TYPES: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf',
      'text/plain',
    ],
    JWT_SECRET: 'test',
  },
}));

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function buildApp() {
  const { default: uploadRoutes } = await import('./uploads.js');
  const app = express();
  app.use('/api/v1/uploads', uploadRoutes);
  return app;
}

async function makeJpegWithExif(): Promise<Buffer> {
  return sharp({
    create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .withExif({
      IFD0: { Make: 'Leak', Model: 'Phone X' },
      GPS: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '50/1 50/1 30/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '4/1 21/1 0/1',
      },
    })
    .jpeg()
    .toBuffer();
}

describe('uploads route — EXIF strip integration', () => {
  beforeEach(() => {
    storageUploadMock.mockClear();
    storageUploadMock.mockImplementation(async (_buf, filename) => `/uploads/${filename}`);
  });

  it('POST / strips EXIF from image buffer before storage.upload', async () => {
    const app = await buildApp();
    const original = await makeJpegWithExif();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const res = await request(app)
      .post('/api/v1/uploads')
      .attach('file', original, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(storageUploadMock).toHaveBeenCalledTimes(1);

    const uploadedBuffer = storageUploadMock.mock.calls[0][0] as Buffer;
    const meta = await sharp(uploadedBuffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe('jpeg');
  });

  it('POST /multi strips EXIF from each image', async () => {
    const app = await buildApp();
    const a = await makeJpegWithExif();
    const b = await makeJpegWithExif();

    const res = await request(app)
      .post('/api/v1/uploads/multi')
      .attach('files', a, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('files', b, { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(storageUploadMock).toHaveBeenCalledTimes(2);
    for (const call of storageUploadMock.mock.calls) {
      const meta = await sharp(call[0] as Buffer).metadata();
      expect(meta.exif).toBeUndefined();
    }
  });

  it('POST / leaves PDF buffers unchanged (no sharp pipeline)', async () => {
    const app = await buildApp();
    const pdfBytes = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from('1 0 obj<</Type/Catalog>>endobj\n'),
      Buffer.from('trailer<<>>\n%%EOF\n'),
    ]);

    const res = await request(app)
      .post('/api/v1/uploads')
      .attach('file', pdfBytes, { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(storageUploadMock).toHaveBeenCalledTimes(1);

    const uploadedBuffer = storageUploadMock.mock.calls[0][0] as Buffer;
    expect(uploadedBuffer.equals(pdfBytes)).toBe(true);
  });
});
