/**
 * Orphan upload reaper.
 *
 * Uploads land in storage at /api/v1/uploads/ and return a URL. The user then
 * (typically) attaches that URL to a message via messageLifecycle.send/edit.
 * If the user closes the compose window without sending, the blob lives in
 * storage forever — the GDPR daily purge only sweeps blobs referenced by
 * purged messages, so unreferenced blobs are never reached.
 *
 * This module is the schema-less reaper for that case (Option A in the
 * design discussion). It walks storage, builds a set of filenames that ARE
 * referenced by `messages.media_url` or `messages.attachments[].url`, and
 * deletes any blob that is unreferenced AND older than a grace window.
 *
 * Grace window matters: a blob uploaded 30s ago whose user is still typing
 * looks identical to an abandoned orphan. Default grace = 24h, configurable
 * via `ORPHAN_UPLOAD_GRACE_MS`. Compose sessions don't last that long; we
 * trade promptness for safety.
 *
 * Called from `runDailyPurge()` after the message-attached file cleanup
 * has committed.
 */

import { db } from '../db.js';
import { messages, auditLog } from '../db/schema.js';
import { isNotNull } from 'drizzle-orm';
import logger from '../utils/logger.js';
import { getStorage } from './storage.js';

/** Default grace window: 24h. Blob younger than this is never reaped. */
const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

interface ReapResult {
  scanned: number;
  referenced: number;
  deleted: number;
  withinGrace: number;
  errors: number;
}

/**
 * Build the set of filenames currently referenced by any message row.
 * Walks `messages.media_url` and `messages.attachments[].url`, keeping only
 * `/uploads/<filename>` entries (other URLs — external link previews etc. —
 * don't gate blob retention).
 */
async function buildReferencedFilenames(): Promise<Set<string>> {
  const rows = await db
    .select({
      mediaUrl: messages.mediaUrl,
      attachments: messages.attachments,
    })
    .from(messages)
    .where(isNotNull(messages.id)); // every row, only the two columns we need
  const out = new Set<string>();
  for (const row of rows) {
    if (row.mediaUrl && row.mediaUrl.startsWith('/uploads/')) {
      out.add(row.mediaUrl.replace(/^\/uploads\//, ''));
    }
    const rawAtt = row.attachments as unknown;
    const attachments: Array<{ url?: string }> = Array.isArray(rawAtt)
      ? (rawAtt as Array<{ url?: string }>)
      : typeof rawAtt === 'string'
        ? (() => {
            try {
              return JSON.parse(rawAtt) as Array<{ url?: string }>;
            } catch {
              return [];
            }
          })()
        : [];
    for (const a of attachments) {
      if (a?.url?.startsWith('/uploads/')) {
        out.add(a.url.replace(/^\/uploads\//, ''));
      }
    }
  }
  return out;
}

/**
 * Sweep the storage backend for orphan blobs and delete anything past the
 * grace window. Best-effort per blob — a single delete failure is logged
 * and the sweep continues. Writes one `system.orphan_upload_reap` audit row
 * with summary counters at the end.
 */
export async function reapOrphanUploads(opts?: { graceMs?: number }): Promise<ReapResult> {
  const graceMs = opts?.graceMs ?? DEFAULT_GRACE_MS;
  const cutoffMs = Date.now() - graceMs;
  const storage = getStorage();

  const result: ReapResult = { scanned: 0, referenced: 0, deleted: 0, withinGrace: 0, errors: 0 };

  let referenced: Set<string>;
  try {
    referenced = await buildReferencedFilenames();
  } catch (err) {
    logger.error({ err }, '[orphan-reaper] failed to build referenced-filenames set; aborting sweep');
    return result;
  }

  let blobs: Array<{ name: string; lastModifiedMs: number }>;
  try {
    blobs = await storage.list();
  } catch (err) {
    logger.error({ err }, '[orphan-reaper] failed to list storage; aborting sweep');
    return result;
  }

  result.scanned = blobs.length;

  for (const blob of blobs) {
    if (referenced.has(blob.name)) {
      result.referenced++;
      continue;
    }
    if (blob.lastModifiedMs > cutoffMs) {
      result.withinGrace++;
      continue;
    }
    try {
      await storage.delete(blob.name);
      result.deleted++;
    } catch (err) {
      result.errors++;
      logger.warn(
        { blob: blob.name, err: err instanceof Error ? err.message : String(err) },
        '[orphan-reaper] storage.delete failed',
      );
    }
  }

  if (result.deleted > 0 || result.scanned > 0) {
    logger.info(result, '[orphan-reaper] sweep complete');
  }

  // Audit row only when we actually changed state — keeps the log signal-rich.
  if (result.deleted > 0 || result.errors > 0) {
    try {
      await db.insert(auditLog).values({
        action: 'system.orphan_upload_reap',
        actorId: null,
        targetType: 'system',
        metadata: { ...result, graceMs },
      });
    } catch (err) {
      logger.warn({ err }, '[orphan-reaper] failed to write audit row (non-fatal)');
    }
  }

  return result;
}
