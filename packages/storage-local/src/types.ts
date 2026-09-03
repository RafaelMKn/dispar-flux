import type { Readable } from 'node:stream';

/**
 * Metadata for a stored media item.
 * Opaque key is a hash or pseudorandom identifier that never reveals absolute paths (ADR 0012).
 */
export interface StorageMetadata {
  /**
   * Hashed opaque identifier, e.g. "med_0123456789abcdef...".
   */
  key: string;

  /**
   * File size in bytes.
   */
  size: number;

  /**
   * MIME content type (e.g. "audio/ogg", "audio/mp4", "video/mp4", "image/jpeg").
   */
  contentType: string;

  /**
   * SHA-256 digest of the payload for integrity checks.
   */
  sha256: string;

  /**
   * Original filename if provided, preserved in metadata only (never as a path).
   */
  originalFilename?: string;

  /**
   * Timestamp when the file was created.
   */
  createdAt: Date;
}

export interface PutOptions {
  /**
   * MIME type of the uploaded media. Defaults to "application/octet-stream".
   */
  contentType?: string;

  /**
   * Original filename (e.g. from upload form).
   */
  filename?: string;

  /**
   * Optional custom opaque key. Must conform to safe opaque identifier format.
   */
  customKey?: string;
}

export interface StreamRangeOptions {
  /**
   * Start byte offset (inclusive).
   */
  start?: number;

  /**
   * End byte offset (inclusive).
   */
  end?: number;
}

/**
 * Abstract storage contract per ADR 0012.
 * Hides filesystem or object store details behind opaque identifiers.
 */
export interface StorageProvider {
  /**
   * Persists binary data or stream and returns opaque metadata.
   */
  put(data: Buffer | Uint8Array | Readable, options?: PutOptions): Promise<StorageMetadata>;

  /**
   * Retrieves full file content as a Buffer.
   */
  get(key: string): Promise<Buffer>;

  /**
   * Deletes a stored file and its metadata.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Returns a readable stream, optionally constrained by range (start, end inclusive).
   */
  getStream(key: string, range?: StreamRangeOptions): Promise<Readable>;

  /**
   * Retrieves metadata for the given opaque key without reading the file body.
   */
  getMetadata(key: string): Promise<StorageMetadata | null>;
}

export interface AuthorizedUrlOptions {
  /**
   * Opaque media key.
   */
  key: string;

  /**
   * Secret key for signing (e.g. operational key / installation secret).
   */
  secret: string;

  /**
   * Expiration duration in seconds. Default is 300 (5 minutes).
   */
  expiresInSeconds?: number;

  /**
   * Base URL path for media endpoint. Default is "/api/v1/media".
   */
  baseUrl?: string;

  /**
   * Optional member ID requesting the URL for audit tracking.
   */
  memberId?: string;

  /**
   * Purpose of access.
   */
  purpose?: 'inline' | 'download' | 'stream';
}

export interface VerifyMediaAccessParams {
  key: string;
  token: string;
  expires: number;
  secret: string;
  purpose?: string;
  memberId?: string;
}

export interface StreamRangeResult {
  statusCode: number;
  headers: Record<string, string | number>;
  stream?: Readable;
}
