/**
 * Contract tests for the storage adapter delete path used by:
 *   - GDPR daily purge (gdpr.ts → storage.delete for purged messages)
 *   - messageLifecycle.delete (soft-delete cleans up blobs)
 *
 * The Azure path is exercised against a mocked @azure/storage-blob client so
 * we can prove the gdpr → storage handoff hits `deleteIfExists` without
 * needing a live container. Real-container verification still belongs in a
 * pre-prod sweep — see memory `Azure Blob + 30d GDPR auto-removal`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Hoisted mock for @azure/storage-blob — lets us substitute the SDK without
// pulling the real package into the test runtime.
const deleteIfExistsMock = vi.fn(async () => ({ succeeded: true }));
const getBlockBlobClientMock = vi.fn(() => ({ deleteIfExists: deleteIfExistsMock }));
const createIfNotExistsMock = vi.fn(async () => undefined);
const fromConnectionStringMock = vi.fn(() => ({
  getContainerClient: () => ({
    getBlockBlobClient: getBlockBlobClientMock,
    createIfNotExists: createIfNotExistsMock,
  }),
}));

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: { fromConnectionString: fromConnectionStringMock },
}));

describe('LocalStorage.delete', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadLocalStorage() {
    vi.doMock('../config.js', () => ({
      default: { AZURE_STORAGE_CONNECTION_STRING: '', AZURE_STORAGE_CONTAINER: '' },
    }));
    const mod = await import('./storage.js');
    return mod.getStorage();
  }

  it('removes the file from disk after upload', async () => {
    const storage = await loadLocalStorage();
    const filename = `gdpr-test-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
    await storage.upload(Buffer.from('payload'), filename, 'application/octet-stream');

    // Verify upload succeeded by reading it back
    const before = await storage.read(filename);
    expect(before.toString()).toBe('payload');

    await storage.delete(filename);

    await expect(storage.read(filename)).rejects.toThrow();
  });

  it('is idempotent — deleting a missing file does not throw', async () => {
    const storage = await loadLocalStorage();
    await expect(storage.delete(`does-not-exist-${Date.now()}.bin`)).resolves.toBeUndefined();
  });

  it('rejects path traversal in the filename', async () => {
    const storage = await loadLocalStorage();
    await expect(storage.delete('../../etc/passwd')).rejects.toThrow(/Invalid filename/);
    await expect(storage.delete('..\\windows\\system32')).rejects.toThrow(/Invalid filename/);
    await expect(storage.delete('foo\0bar')).rejects.toThrow(/Invalid filename/);
  });
});

describe('AzureBlobStorage.delete', () => {
  beforeEach(() => {
    vi.resetModules();
    deleteIfExistsMock.mockClear();
    getBlockBlobClientMock.mockClear();
    fromConnectionStringMock.mockClear();
  });

  async function loadAzureStorage() {
    vi.doMock('../config.js', () => ({
      default: {
        AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;EndpointSuffix=core.windows.net',
        AZURE_STORAGE_CONTAINER: 'uploads',
      },
    }));
    const mod = await import('./storage.js');
    return mod.getStorage();
  }

  it('calls deleteIfExists with the blob name', async () => {
    const storage = await loadAzureStorage();
    await storage.delete('photo.png');

    expect(getBlockBlobClientMock).toHaveBeenCalledWith('photo.png');
    expect(deleteIfExistsMock).toHaveBeenCalledTimes(1);
  });

  it('swallows transient SDK failures so the GDPR purge can continue', async () => {
    deleteIfExistsMock.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    const storage = await loadAzureStorage();
    await expect(storage.delete('photo.png')).resolves.toBeUndefined();
  });

  it('rejects path traversal before reaching the SDK', async () => {
    const storage = await loadAzureStorage();
    await storage.delete('../escape.bin');
    // assertSafeFilename throws → catch block logs warning → SDK never called
    expect(deleteIfExistsMock).not.toHaveBeenCalled();
  });
});
