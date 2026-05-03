// server/services/exifStrip.test.ts
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { shouldStripMetadata, stripImageMetadata } from './exifStrip.js';

async function makeJpegWithGps(): Promise<Buffer> {
  // 100x100 red square with embedded EXIF GPS (Brussels-ish lat/lng).
  return sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .withExif({
      IFD0: {
        Make: 'TestPhone',
        Model: 'PrivacyLeaker 1',
        Software: 'GuichetUnit',
      },
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

describe('shouldStripMetadata', () => {
  it.each([
    ['image/png', true],
    ['image/jpeg', true],
    ['image/webp', true],
    ['image/gif', false],
    ['application/pdf', false],
    ['text/plain', false],
    [undefined, false],
  ])('%s → %s', (mime, expected) => {
    expect(shouldStripMetadata(mime as string | undefined)).toBe(expected);
  });
});

describe('stripImageMetadata', () => {
  it('removes embedded EXIF (incl. GPS) from a JPEG', async () => {
    const original = await makeJpegWithGps();

    const beforeMeta = await sharp(original).metadata();
    expect(beforeMeta.exif).toBeDefined();
    expect(beforeMeta.exif?.length).toBeGreaterThan(0);

    const stripped = await stripImageMetadata(original, 'image/jpeg');
    const afterMeta = await sharp(stripped).metadata();

    expect(afterMeta.exif).toBeUndefined();
    expect(afterMeta.format).toBe('jpeg');
    expect(afterMeta.width).toBe(100);
    expect(afterMeta.height).toBe(100);
  });

  it('downscales oversized images to IMAGE_MAX_DIMENSION (default 2000)', async () => {
    const big = await sharp({
      create: { width: 4032, height: 3024, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const stripped = await stripImageMetadata(big, 'image/jpeg');
    const afterMeta = await sharp(stripped).metadata();

    expect(afterMeta.width).toBe(2000);
    expect(afterMeta.height).toBe(1500);
  });

  it('does not enlarge images smaller than IMAGE_MAX_DIMENSION', async () => {
    const small = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const stripped = await stripImageMetadata(small, 'image/png');
    const afterMeta = await sharp(stripped).metadata();

    expect(afterMeta.width).toBe(200);
    expect(afterMeta.height).toBe(200);
  });

  it('passes PDF buffers through unchanged (byte-for-byte)', async () => {
    const fakePdf = Buffer.from('%PDF-1.7\nfake pdf bytes', 'utf-8');
    const result = await stripImageMetadata(fakePdf, 'application/pdf');
    expect(result.equals(fakePdf)).toBe(true);
  });

  it('passes text and unknown buffers through unchanged', async () => {
    const txt = Buffer.from('hello world', 'utf-8');
    expect((await stripImageMetadata(txt, 'text/plain')).equals(txt)).toBe(true);
    expect((await stripImageMetadata(txt, undefined)).equals(txt)).toBe(true);
  });

  it('preserves visual orientation (.rotate before strip)', async () => {
    // A portrait image (taller than wide) tagged with orientation 6 (rotate 90 CW)
    // should — after strip — be in landscape because .rotate() bakes the
    // orientation into pixels before metadata is dropped.
    const portraitWithRotation = await sharp({
      create: { width: 100, height: 200, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const stripped = await stripImageMetadata(portraitWithRotation, 'image/jpeg');
    const afterMeta = await sharp(stripped).metadata();

    expect(afterMeta.width).toBe(200);
    expect(afterMeta.height).toBe(100);
    expect(afterMeta.orientation).toBeUndefined();
  });
});
