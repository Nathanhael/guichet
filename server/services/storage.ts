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

/** Reject filenames with traversal sequences or unsafe characters. */
function assertSafeFilename(filename: string): void {
  const normalized = path.posix.normalize(filename);
  if (
    normalized.startsWith('..') ||
    normalized.includes('/../') ||
    normalized.includes('\\') ||
    normalized.includes('\0')
  ) {
    throw new Error('Invalid filename');
  }
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
    assertSafeFilename(filename);
    const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
    await fs.promises.writeFile(filePath, buffer);
    return `/uploads/${filename}`;
  }

  async delete(filename: string): Promise<void> {
    assertSafeFilename(filename);
    const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ filename, err }, '[storage:local] failed to delete file');
      }
    }
  }

  getUrl(filename: string): string {
    return `/uploads/${filename}`;
  }

  async read(filename: string): Promise<Buffer> {
    assertSafeFilename(filename);
    const filePath = path.join(LOCAL_UPLOAD_DIR, filename);
    // Double-check resolved path stays within upload dir
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
  /** Promise-based init lock — ensures only one init runs even under concurrency. */
  private initPromise: Promise<import('@azure/storage-blob').ContainerClient> | null = null;

  private getContainer(): Promise<import('@azure/storage-blob').ContainerClient> {
    if (!this.initPromise) {
      this.initPromise = this._init();
    }
    return this.initPromise;
  }

  private async _init(): Promise<import('@azure/storage-blob').ContainerClient> {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    const connStr = config.AZURE_STORAGE_CONNECTION_STRING!;
    const blobService = BlobServiceClient.fromConnectionString(connStr);
    const containerClient = blobService.getContainerClient(config.AZURE_STORAGE_CONTAINER);
    // Private container — blobs only accessible via connection string / SAS.
    // All client access goes through the auth-gated /uploads proxy (SEC-6).
    await containerClient.createIfNotExists();
    logger.info({ container: config.AZURE_STORAGE_CONTAINER }, '[storage:azure] container ready');
    return containerClient;
  }

  async upload(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    assertSafeFilename(filename);
    const container = await this.getContainer();
    const blockBlob = container.getBlockBlobClient(filename);
    await blockBlob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType },
    });
    return `/uploads/${filename}`;
  }

  async delete(filename: string): Promise<void> {
    try {
      assertSafeFilename(filename);
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
    assertSafeFilename(filename);
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

// ── AWS S3 Backend ─────────────────────────────────────────────────────────────

class S3Storage implements StorageBackend {
  private clientPromise: Promise<{ s3: import('@aws-sdk/client-s3').S3Client; bucket: string }> | null = null;

  private getClient() {
    if (!this.clientPromise) this.clientPromise = this._init();
    return this.clientPromise;
  }

  private async _init() {
    const { S3Client, CreateBucketCommand, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const bucket = config.AWS_S3_BUCKET!;
    const s3 = new S3Client({
      region: config.AWS_REGION || 'eu-west-1',
      ...(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY ? {
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      } : {}),
    });
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => {});
    }
    logger.info({ bucket }, '[storage:s3] bucket ready');
    return { s3, bucket };
  }

  async upload(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    assertSafeFilename(filename);
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { s3, bucket } = await this.getClient();
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: filename,
      Body: buffer,
      ContentType: mimeType,
    }));
    return `/uploads/${filename}`;
  }

  async delete(filename: string): Promise<void> {
    try {
      assertSafeFilename(filename);
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const { s3, bucket } = await this.getClient();
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: filename }));
    } catch (err) {
      logger.warn({ filename, err }, '[storage:s3] failed to delete object');
    }
  }

  getUrl(filename: string): string {
    return `/uploads/${filename}`;
  }

  async read(filename: string): Promise<Buffer> {
    assertSafeFilename(filename);
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { s3, bucket } = await this.getClient();
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: filename }));
    const stream = response.Body as AsyncIterable<Buffer>;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async healthy(): Promise<boolean> {
    try {
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const { s3, bucket } = await this.getClient();
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
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
    } else if (config.AWS_S3_BUCKET) {
      instance = new S3Storage();
      logger.info('[storage] using AWS S3 backend');
    } else {
      instance = new LocalStorage();
      logger.info('[storage] using local filesystem backend');
    }
  }
  return instance;
}
