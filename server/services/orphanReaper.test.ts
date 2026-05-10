/**
 * Contract tests for the orphan-upload reaper.
 *
 * The unit under test is `reapOrphanUploads()` — given a list of blobs in
 * storage and a set of filenames referenced by `messages`, it must:
 *  - keep every referenced blob (regardless of age)
 *  - keep every blob within the grace window (regardless of references)
 *  - delete every blob that is unreferenced AND older than the grace window
 *  - tolerate per-blob delete failures without aborting the sweep
 *  - write a single audit row with summary counters when state changed
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const messageRows: Array<{ mediaUrl: string | null; attachments: unknown }> = [];
const blobsList: Array<{ name: string; lastModifiedMs: number }> = [];
const storageDeleteMock = vi.fn(async (_filename: string) => undefined);
const auditInsertValuesMock = vi.fn(async () => undefined);

// db.select().from(messages).where(...) — only the two columns used by the
// reaper are needed. Returns the staged messageRows.
const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(messageRows)),
    })),
  })),
  insert: vi.fn(() => ({
    values: auditInsertValuesMock,
  })),
};

vi.mock('../db.js', () => ({ db: dbMock }));
vi.mock('../db/schema.js', () => ({
  messages: { id: 'id', mediaUrl: 'media_url', attachments: 'attachments' },
  auditLog: 'audit_log_table',
}));
vi.mock('drizzle-orm', () => ({
  isNotNull: vi.fn(() => ({ op: 'isnotnull' })),
}));
vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./storage.js', () => ({
  getStorage: () => ({
    list: async () => blobsList.slice(),
    delete: storageDeleteMock,
  }),
}));

const HOUR_MS = 60 * 60 * 1000;

describe('reapOrphanUploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageRows.length = 0;
    blobsList.length = 0;
    storageDeleteMock.mockReset();
    storageDeleteMock.mockResolvedValue(undefined);
    auditInsertValuesMock.mockReset();
    auditInsertValuesMock.mockResolvedValue(undefined);
  });

  it('keeps referenced blobs regardless of age', async () => {
    messageRows.push({ mediaUrl: '/uploads/photo.png', attachments: null });
    blobsList.push({ name: 'photo.png', lastModifiedMs: Date.now() - 30 * 24 * HOUR_MS }); // 30 days old

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    const r = await reapOrphanUploads();

    expect(r).toMatchObject({ scanned: 1, referenced: 1, deleted: 0, withinGrace: 0, errors: 0 });
    expect(storageDeleteMock).not.toHaveBeenCalled();
  });

  it('keeps blobs referenced via attachments JSONB array', async () => {
    messageRows.push({
      mediaUrl: null,
      attachments: [{ url: '/uploads/file-1.pdf' }, { url: '/uploads/file-2.zip' }],
    });
    blobsList.push(
      { name: 'file-1.pdf', lastModifiedMs: Date.now() - 30 * 24 * HOUR_MS },
      { name: 'file-2.zip', lastModifiedMs: Date.now() - 30 * 24 * HOUR_MS },
    );

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    const r = await reapOrphanUploads();

    expect(r.referenced).toBe(2);
    expect(r.deleted).toBe(0);
    expect(storageDeleteMock).not.toHaveBeenCalled();
  });

  it('parses legacy stringified attachments JSONB', async () => {
    messageRows.push({
      mediaUrl: null,
      attachments: JSON.stringify([{ url: '/uploads/legacy.pdf' }]),
    });
    blobsList.push({ name: 'legacy.pdf', lastModifiedMs: Date.now() - 30 * 24 * HOUR_MS });

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    const r = await reapOrphanUploads();

    expect(r.referenced).toBe(1);
    expect(r.deleted).toBe(0);
  });

  it('skips orphan blobs within the grace window', async () => {
    blobsList.push({ name: 'fresh-orphan.png', lastModifiedMs: Date.now() - 1 * HOUR_MS });

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    const r = await reapOrphanUploads({ graceMs: 24 * HOUR_MS });

    expect(r).toMatchObject({ scanned: 1, withinGrace: 1, deleted: 0 });
    expect(storageDeleteMock).not.toHaveBeenCalled();
  });

  it('deletes orphan blobs older than the grace window', async () => {
    blobsList.push(
      { name: 'old-orphan-1.png', lastModifiedMs: Date.now() - 48 * HOUR_MS },
      { name: 'old-orphan-2.pdf', lastModifiedMs: Date.now() - 72 * HOUR_MS },
    );

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    const r = await reapOrphanUploads({ graceMs: 24 * HOUR_MS });

    expect(r).toMatchObject({ scanned: 2, deleted: 2, errors: 0 });
    expect(storageDeleteMock).toHaveBeenCalledWith('old-orphan-1.png');
    expect(storageDeleteMock).toHaveBeenCalledWith('old-orphan-2.pdf');
  });

  it('mixed batch — keeps referenced + in-grace, deletes only the eligible orphans', async () => {
    messageRows.push({ mediaUrl: '/uploads/keeper.png', attachments: null });
    blobsList.push(
      { name: 'keeper.png', lastModifiedMs: Date.now() - 100 * HOUR_MS },          // referenced
      { name: 'fresh.png', lastModifiedMs: Date.now() - 1 * HOUR_MS },              // in grace
      { name: 'orphan.png', lastModifiedMs: Date.now() - 100 * HOUR_MS },           // delete me
    );

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    const r = await reapOrphanUploads({ graceMs: 24 * HOUR_MS });

    expect(r).toMatchObject({ scanned: 3, referenced: 1, withinGrace: 1, deleted: 1 });
    expect(storageDeleteMock).toHaveBeenCalledTimes(1);
    expect(storageDeleteMock).toHaveBeenCalledWith('orphan.png');
  });

  it('continues sweeping when a single delete throws (transient SDK error)', async () => {
    storageDeleteMock
      .mockRejectedValueOnce(new Error('Azure 503'))
      .mockResolvedValueOnce(undefined);
    blobsList.push(
      { name: 'fail.png', lastModifiedMs: Date.now() - 48 * HOUR_MS },
      { name: 'ok.png', lastModifiedMs: Date.now() - 48 * HOUR_MS },
    );

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    const r = await reapOrphanUploads({ graceMs: 24 * HOUR_MS });

    expect(r).toMatchObject({ scanned: 2, deleted: 1, errors: 1 });
    // Both deletes attempted — the second one succeeded after the first failed.
    expect(storageDeleteMock).toHaveBeenCalledTimes(2);
  });

  it('writes audit row only when state changed (deletes or errors)', async () => {
    blobsList.push({ name: 'old-orphan.png', lastModifiedMs: Date.now() - 48 * HOUR_MS });

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    await reapOrphanUploads({ graceMs: 24 * HOUR_MS });

    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(auditInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.orphan_upload_reap',
        actorId: null,
        targetType: 'system',
        metadata: expect.objectContaining({ deleted: 1, scanned: 1, graceMs: 24 * HOUR_MS }),
      }),
    );
  });

  it('does NOT write an audit row when nothing changed (all kept)', async () => {
    blobsList.push({ name: 'fresh.png', lastModifiedMs: Date.now() - 1 * HOUR_MS });

    const { reapOrphanUploads } = await import('./orphanReaper.js');
    await reapOrphanUploads({ graceMs: 24 * HOUR_MS });

    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});
