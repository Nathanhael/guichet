import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from '../config.js';
import logger from '../utils/logger.js';

// ── Storage Backend Interface ──────────────────────────────────────────────────

export interface StorageBackend {
  /** Upload a file buffer and return the URL to access it. */
  upload(buffer: Buffer, filename: string, mimeType: string): Promise<string>;
  /** Delete a file by its stored filename. */
  delete(filename: string): Promise<void>;
  /** Resolve a filename to a serveable URL (or local path). */
  getUrl(filename: string): string;
  /** Read a file back as a buffer (for proxying to client). */
  read(filename: string): Promise<Buffer>;
  /** Check if the backend is healthy. */
  healthy(): Promise<boolean>;
}

// ── Local Filesystem Backend ───────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

class LocalStorage implements StorageBackend {
  constructor() {
    if (!fs.existsSync(LOCAL_UPLOAD_DIR)) {
      fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
    }
  }

  async upload(buffer: Buffer, filename: string, _mimeType: string): Promise<string> {
    const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
    await fs.promises.writeFile(filePath, buffer);
    return `/uploads/${filename}`;
  }

  async delete(filename: string): Promise<void> {
    const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: unknown) {
      // File may already be deleted — only warn, don't throw
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ filename, err }, '[storage:local] failed to delete file');
      }
    }
  }

  getUrl(filename: string): string {
    return `/uploads/${filename}`;
  }

  async read(filename: string): Promise<Buffer> {
    // filename may include subdirectories (e.g. "logos/logo_abc.png")
    const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
    // Guard against path traversal
    if (!filePath.startsWith(LOCAL_UPLOAD_DIR)) {
      throw new Error('Invalid path');
    }
    return fs.promises.readFile(filePath);
  }

  async healthy(): Promise<boolean> {
    return fs.existsSync(LOCAL_UPLOAD_DIR);
  }
}

// ── Azure Blob Storage Backend ─────────────────────────────────────────────────

class AzureBlobStorage implements StorageBackend {
  private containerClient: import('@azure/storage-blob').ContainerClient | null = null;
  private initialized = false;

  private async getContainer(): Promise<import('@azure/storage-blob').ContainerClient> {
    if (this.containerClient) return this.containerClient;
    const { BlobServiceClient } = await import('@azure/storage-blob');
    const connStr = config.AZURE_STORAGE_CONNECTION_STRING!;
    const blobService = BlobServiceClient.fromConnectionString(connStr);
    this.containerClient = blobService.getContainerClient(config.AZURE_STORAGE_CONTAINER);
    if (!this.initialized) {
      await this.containerClient.createIfNotExists({ access: 'blob' });
      this.initialized = true;
      logger.info({ container: config.AZURE_STORAGE_CONTAINER }, '[storage:azure] container ready');
    }
    return this.containerClient;
  }

  async upload(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const container = await this.getContainer();
    const blockBlob = container.getBlockBlobClient(filename);
    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType },
    });
    // Return relative URL — served through our auth-gated proxy route
    return `/uploads/${filename}`;
  }

  async delete(filename: string): Promise<void> {
    try {
      const container = await this.getContainer();
      await container.getBlockBlobClient(filename).deleteIfExists();
    } catch (err) {
      logger.warn({ filename, err }, '[storage:azure] failed to delete blob');
    }
  }

  getUrl(filename: string): string {
    return `/uploads/${filename}`;
  }

  async read(filename: string): Promise<Buffer> {
    const container = await this.getContainer();
    const blob = container.getBlockBlobClient(filename);
    const response = await blob.download(0);
    const chunks: Buffer[] = [];
    for await (const chunk of response.readableStreamBody as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async healthy(): Promise<boolean> {
    try {
      const container = await this.getContainer();
      await container.getProperties();
      return true;
    } catch {
      return false;
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

let instance: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (!instance) {
    if (config.AZURE_STORAGE_CONNECTION_STRING) {
      instance = new AzureBlobStorage();
      logger.info('[storage] using Azure Blob Storage backend');
    } else {
      instance = new LocalStorage();
      logger.info('[storage] using local filesystem backend');
    }
  }
  return instance;
}
