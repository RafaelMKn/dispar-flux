import type { IncomingMessage, ServerResponse } from 'node:http';

export class PayloadTooLargeError extends Error {
  public readonly statusCode = 413;
  public readonly limitBytes: number;

  constructor(message: string, limitBytes: number) {
    super(message);
    this.name = 'PayloadTooLargeError';
    this.limitBytes = limitBytes;
  }
}

export interface BodyLimitOptions {
  defaultLimitBytes?: number;
  uploadLimitBytes?: number;
  uploadPrefixes?: string[];
}

export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024; // 1 MB
export const DEFAULT_UPLOAD_LIMIT_BYTES = 32 * 1024 * 1024; // 32 MB

export class SizeLimitHandler {
  private readonly defaultLimitBytes: number;
  private readonly uploadLimitBytes: number;
  private readonly uploadPrefixes: string[];

  constructor(options: BodyLimitOptions = {}) {
    this.defaultLimitBytes = options.defaultLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
    this.uploadLimitBytes = options.uploadLimitBytes ?? DEFAULT_UPLOAD_LIMIT_BYTES;
    this.uploadPrefixes = options.uploadPrefixes ?? [
      '/api/v1/migration',
      '/api/v1/backup/restore',
      '/api/v1/media/upload',
    ];
  }

  resolveLimit(pathname: string): number {
    for (const prefix of this.uploadPrefixes) {
      if (pathname.startsWith(prefix)) {
        return this.uploadLimitBytes;
      }
    }
    return this.defaultLimitBytes;
  }

  /**
   * Fast header check for Content-Length before consuming the request body stream.
   * Sends 413 response and returns true if content length exceeds limit.
   */
  checkContentLength(req: IncomingMessage, res: ServerResponse, pathname?: string): boolean {
    const path = pathname || (req.url ? req.url.split('?')[0] || '/' : '/');
    const limit = this.resolveLimit(path);

    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader) {
      const length = parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(length) && length > limit) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'Payload Too Large',
            message: `Request body size (${length} bytes) exceeds limit (${limit} bytes)`,
            limitBytes: limit,
          })
        );
        return true;
      }
    }
    return false;
  }

  /**
   * Consumes request body with strict byte counter limit.
   * If limit is exceeded during streaming, request stream is paused and rejected.
   */
  async readBody(req: IncomingMessage, limitBytes?: number): Promise<Buffer> {
    const limit = limitBytes ?? this.resolveLimit(req.url ? req.url.split('?')[0] || '/' : '/');

    // Early Content-Length check
    const contentLength = req.headers['content-length'];
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (!Number.isNaN(length) && length > limit) {
        throw new PayloadTooLargeError(`Request content length exceeds ${limit} bytes`, limit);
      }
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      const onData = (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > limit) {
          req.removeListener('data', onData);
          req.removeListener('end', onEnd);
          req.removeListener('error', onError);
          req.pause();
          reject(new PayloadTooLargeError(`Request body exceeded size limit of ${limit} bytes`, limit));
          return;
        }
        chunks.push(chunk);
      };

      const onEnd = () => {
        resolve(Buffer.concat(chunks));
      };

      const onError = (err: Error) => {
        reject(err);
      };

      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
    });
  }

  /**
   * Helper to read and parse JSON body with size limits.
   */
  async readJson<T = unknown>(req: IncomingMessage, limitBytes?: number): Promise<T> {
    const buffer = await this.readBody(req, limitBytes);
    if (buffer.length === 0) {
      return {} as T;
    }
    try {
      return JSON.parse(buffer.toString('utf-8')) as T;
    } catch (err) {
      throw new Error(`Invalid JSON payload: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function createSizeLimitHandler(options: BodyLimitOptions = {}): SizeLimitHandler {
  return new SizeLimitHandler(options);
}
