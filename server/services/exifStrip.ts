// server/services/exifStrip.ts
//
// Strips embedded metadata (EXIF, ICC, XMP, IPTC) from uploaded images by
// piping through sharp`s default re-encoder. The re-encode also caps width
// at IMAGE_MAX_DIMENSION (default 2000) — phone-camera resolution is wasted
// on helpdesk screenshots and inflates storage. Aspect ratio is preserved.
//
// Non-image MIME types pass through unchanged. Document metadata stripping
// (PDF, Office) is out of scope here — see follow-up spec.
//
// `.rotate()` (no args) bakes EXIF orientation into pixels before stripping
// metadata; without it, portrait phone photos render sideways after the strip.
import sharp from 'sharp';

const IMAGE_MAX_DIMENSION = Number.parseInt(process.env.IMAGE_MAX_DIMENSION || '2000', 10);
const STRIPPABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function shouldStripMetadata(mime: string | undefined): boolean {
  return !!mime && STRIPPABLE_MIMES.has(mime);
}

export async function stripImageMetadata(buffer: Buffer, mime: string | undefined): Promise<Buffer> {
  if (!shouldStripMetadata(mime)) return buffer;
  return sharp(buffer)
    .rotate()
    .resize({ width: IMAGE_MAX_DIMENSION, withoutEnlargement: true })
    .toBuffer();
}
