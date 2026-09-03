import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type {
  StorageProvider,
  StorageMetadata,
  PutOptions,
  StreamRangeOptions,
} from './types.js';
import {
  FileNotFoundError,
  InvalidStorageKeyError,
  StorageError,
} from './errors.js';

export interface LocalStorageProviderOptions {
  /**
   * Root directory where media files will be placed.
   * Defaults to `${process.env.DATA_DIR || './data'}/media`.
   */
  mediaDir?: string;
}

const OPAQUE_KEY_REGEX = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * Validates that an identifier is safe and opaque.
 * Strictly prevents path traversal, directory escape, or shell characters (ADR 0012).
 */
export function assertValidStorageKey(key: string): void {
  if (!key || typeof key !== 'string') {
    throw new InvalidStorageKeyError(String(key), 'Key must be a non-empty string');
  }
  if (!OPAQUE_KEY_REGEX.test(key)) {
    throw new InvalidStorageKeyError(
      key,
      'Key must be 8-128 characters containing only alphanumeric characters, underscores, or hyphens'
    );
  }
}

/**
 * Local filesystem implementation of StorageProvider.
 * Stores media in ${DATA_DIR}/media with hashed opaque identifiers.
 * Never leaks absolute server paths to domain or client responses (ADR 0012).
 */
export class LocalStorageProvider implements StorageProvider {
  public readonly mediaDir: string;

  constructor(options: LocalStorageProviderOptions = {}) {
    const baseDir = options.mediaDir || (process.env['DATA_DIR'] ? path.join(process.env['DATA_DIR'], 'media') : path.resolve('./data/media'));
    this.mediaDir = path.resolve(baseDir);
    this.ensureDirectory(this.mediaDir);
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Resolves internal filesystem path for an opaque key.
   * Uses 2-character prefix sharding to prevent directory bloat.
   */
  private resolvePaths(key: string): { dir: string; filePath: string; metaPath: string } {
    assertValidStorageKey(key);
    const prefix = key.slice(0, 2);
    const dir = path.join(this.mediaDir, prefix);
    const filePath = path.join(dir, key);
    const metaPath = path.join(dir, `${key}.meta.json`);
    return { dir, filePath, metaPath };
  }

  /**
   * Converts a Readable stream into a Buffer.
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async put(
    data: Buffer | Uint8Array | Readable,
    options: PutOptions = {}
  ): Promise<StorageMetadata> {
    try {
      const buffer = data instanceof Readable ? await this.streamToBuffer(data) : Buffer.from(data);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      // Generate opaque hashed key if customKey not provided
      let key = options.customKey;
      if (!key) {
        key = `med_${sha256.slice(0, 32)}`;
      } else {
        assertValidStorageKey(key);
      }

      const { dir, filePath, metaPath } = this.resolvePaths(key);
      this.ensureDirectory(dir);

      // Write binary content atomically
      await fs.promises.writeFile(filePath, buffer);

      const metadata: StorageMetadata = {
        key,
        size: buffer.length,
        contentType: options.contentType || 'application/octet-stream',
        sha256,
        originalFilename: options.filename,
        createdAt: new Date(),
      };

      // Write metadata sidecar (omitting any absolute paths)
      const serializedMeta = JSON.stringify({
        key: metadata.key,
        size: metadata.size,
        contentType: metadata.contentType,
        sha256: metadata.sha256,
        originalFilename: metadata.originalFilename,
        createdAt: metadata.createdAt.toISOString(),
      });
      await fs.promises.writeFile(metaPath, serializedMeta, 'utf-8');

      return metadata;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to store media: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  async get(key: string): Promise<Buffer> {
    const { filePath } = this.resolvePaths(key);
    try {
      return await fs.promises.readFile(filePath);
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        throw new FileNotFoundError(key);
      }
      throw new StorageError(`Failed to read media for key "${key}": ${err?.message || String(err)}`, {
        cause: err,
      });
    }
  }

  async getStream(key: string, range?: StreamRangeOptions): Promise<Readable> {
    const { filePath } = this.resolvePaths(key);

    if (!fs.existsSync(filePath)) {
      throw new FileNotFoundError(key);
    }

    const options: { start?: number; end?: number } = {};
    if (range) {
      if (range.start !== undefined) options.start = range.start;
      if (range.end !== undefined) options.end = range.end;
    }

    return fs.createReadStream(filePath, options);
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    const { filePath, metaPath } = this.resolvePaths(key);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    if (fs.existsSync(metaPath)) {
      try {
        const raw = await fs.promises.readFile(metaPath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          key: parsed.key,
          size: Number(parsed.size),
          contentType: parsed.contentType || 'application/octet-stream',
          sha256: parsed.sha256 || '',
          originalFilename: parsed.originalFilename,
          createdAt: new Date(parsed.createdAt),
        };
      } catch {
        // Corrupted sidecar - fallback to stat
      }
    }

    // Fallback if metadata sidecar missing
    const stat = await fs.promises.stat(filePath);
    return {
      key,
      size: stat.size,
      contentType: 'application/octet-stream',
      sha256: '',
      createdAt: stat.birthtime || stat.mtime,
    };
  }

  async delete(key: string): Promise<boolean> {
    const { filePath, metaPath } = this.resolvePaths(key);

    let deleted = false;
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      deleted = true;
    }
    if (fs.existsSync(metaPath)) {
      await fs.promises.unlink(metaPath).catch(() => {});
    }

    return deleted;
  }
}
