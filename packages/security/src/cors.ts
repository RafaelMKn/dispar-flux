import type { IncomingMessage, ServerResponse } from 'node:http';

export interface CorsOptions {
  allowedOrigins?: string[] | ((origin: string) => boolean);
  allowedMethods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  allowCredentials?: boolean;
  maxAge?: number;
}

export const DEFAULT_ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
];

export const DEFAULT_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-CSRF-Token',
  'X-Device-Fingerprint',
  'X-Requested-With',
  'Accept',
];

export const DEFAULT_EXPOSED_HEADERS = [
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'Retry-After',
];

export class CorsHandler {
  private readonly allowedOrigins: string[] | ((origin: string) => boolean);
  private readonly allowedMethods: string[];
  private readonly allowedHeaders: string[];
  private readonly exposedHeaders: string[];
  private readonly allowCredentials: boolean;
  private readonly maxAge: number;

  constructor(options: CorsOptions = {}) {
    this.allowedOrigins = options.allowedOrigins ?? ['http://localhost:3000', 'http://127.0.0.1:3000'];
    this.allowedMethods = options.allowedMethods ?? DEFAULT_ALLOWED_METHODS;
    this.allowedHeaders = options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS;
    this.exposedHeaders = options.exposedHeaders ?? DEFAULT_EXPOSED_HEADERS;
    this.allowCredentials = options.allowCredentials ?? true;
    this.maxAge = options.maxAge ?? 86400;
  }

  isOriginAllowed(origin: string): boolean {
    if (!origin) return false;
    if (typeof this.allowedOrigins === 'function') {
      return this.allowedOrigins(origin);
    }
    if (this.allowedOrigins.includes('*')) {
      return true;
    }
    return this.allowedOrigins.includes(origin);
  }

  /**
   * Applies CORS headers to the response.
   * Returns true if the request was an OPTIONS preflight and was completely handled.
   */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers['origin'];

    if (!origin || typeof origin !== 'string') {
      // Not a cross-origin request
      return false;
    }

    const isAllowed = this.isOriginAllowed(origin);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');

      if (this.allowCredentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }

      if (this.exposedHeaders.length > 0) {
        res.setHeader('Access-Control-Expose-Headers', this.exposedHeaders.join(', '));
      }
    }

    // Handle OPTIONS Preflight
    if (req.method === 'OPTIONS') {
      if (!isAllowed) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'CORS origin not allowed' }));
        return true;
      }

      res.setHeader('Access-Control-Allow-Methods', this.allowedMethods.join(', '));
      res.setHeader('Access-Control-Allow-Headers', this.allowedHeaders.join(', '));
      res.setHeader('Access-Control-Max-Age', this.maxAge.toString());
      res.statusCode = 204;
      res.end();
      return true;
    }

    return false;
  }
}

export function createCorsHandler(options: CorsOptions = {}): CorsHandler {
  return new CorsHandler(options);
}
