import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RateLimitRule {
  /**
   * Path prefix or regex to match request url.
   */
  prefix: string;
  /**
   * Maximum requests allowed within windowMs.
   */
  maxRequests: number;
  /**
   * Window duration in milliseconds.
   */
  windowMs: number;
}

export interface RateLimiterOptions {
  rules?: RateLimitRule[];
  defaultRule?: {
    maxRequests: number;
    windowMs: number;
  };
  keyGenerator?: (req: IncomingMessage) => string;
}

interface ClientRecord {
  count: number;
  windowStart: number;
}

export const DEFAULT_RATE_LIMIT_RULES: RateLimitRule[] = [
  { prefix: '/api/v1/auth/login', maxRequests: 5, windowMs: 60_000 },
  { prefix: '/api/v1/auth/claim', maxRequests: 3, windowMs: 300_000 },
  { prefix: '/api/v1/backup', maxRequests: 10, windowMs: 60_000 },
  { prefix: '/api/v1/migration', maxRequests: 10, windowMs: 60_000 },
];

export class RateLimiter {
  private readonly rules: RateLimitRule[];
  private readonly defaultRule: { maxRequests: number; windowMs: number };
  private readonly keyGenerator: (req: IncomingMessage) => string;
  private readonly stores = new Map<string, Map<string, ClientRecord>>();

  constructor(options: RateLimiterOptions = {}) {
    this.rules = options.rules ?? DEFAULT_RATE_LIMIT_RULES;
    this.defaultRule = options.defaultRule ?? { maxRequests: 120, windowMs: 60_000 };
    this.keyGenerator = options.keyGenerator ?? RateLimiter.defaultKeyGenerator;

    // Periodic cleanup of expired entries every minute
    const interval = setInterval(() => this.cleanup(), 60_000);
    if (interval.unref) interval.unref();
  }

  static defaultKeyGenerator(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0];
      if (first) return first.trim();
    }
    return req.socket.remoteAddress || '127.0.0.1';
  }

  private resolveRule(pathname: string): { key: string; maxRequests: number; windowMs: number } {
    for (const rule of this.rules) {
      if (pathname.startsWith(rule.prefix)) {
        return { key: rule.prefix, maxRequests: rule.maxRequests, windowMs: rule.windowMs };
      }
    }
    return { key: '__default__', ...this.defaultRule };
  }

  /**
   * Checks rate limit for a request.
   * Returns { allowed: boolean, remaining: number, resetSeconds: number, limit: number }.
   */
  check(req: IncomingMessage, pathname?: string, now = Date.now()): {
    allowed: boolean;
    remaining: number;
    resetSeconds: number;
    limit: number;
  } {
    const path = pathname || (req.url ? req.url.split('?')[0] || '/' : '/');
    const rule = this.resolveRule(path);
    const clientKey = this.keyGenerator(req);

    let store = this.stores.get(rule.key);
    if (!store) {
      store = new Map<string, ClientRecord>();
      this.stores.set(rule.key, store);
    }

    let record = store.get(clientKey);
    if (!record || now - record.windowStart >= rule.windowMs) {
      record = { count: 1, windowStart: now };
      store.set(clientKey, record);
      const resetSeconds = Math.ceil(rule.windowMs / 1000);
      return {
        allowed: true,
        remaining: rule.maxRequests - 1,
        resetSeconds,
        limit: rule.maxRequests,
      };
    }

    const resetSeconds = Math.ceil((record.windowStart + rule.windowMs - now) / 1000);

    if (record.count >= rule.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetSeconds: Math.max(1, resetSeconds),
        limit: rule.maxRequests,
      };
    }

    record.count++;
    return {
      allowed: true,
      remaining: rule.maxRequests - record.count,
      resetSeconds: Math.max(1, resetSeconds),
      limit: rule.maxRequests,
    };
  }

  /**
   * Applies rate limiting to the request. If exceeded, sends 429 response and returns true.
   */
  handle(req: IncomingMessage, res: ServerResponse, pathname?: string): boolean {
    const result = this.check(req, pathname);

    res.setHeader('RateLimit-Limit', result.limit.toString());
    res.setHeader('RateLimit-Remaining', result.remaining.toString());
    res.setHeader('RateLimit-Reset', result.resetSeconds.toString());

    if (!result.allowed) {
      res.statusCode = 429;
      res.setHeader('Retry-After', result.resetSeconds.toString());
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please retry later.',
          retryAfterSeconds: result.resetSeconds,
        })
      );
      return true;
    }

    return false;
  }

  private cleanup(now = Date.now()): void {
    for (const [ruleKey, store] of this.stores.entries()) {
      const rule = this.rules.find((r) => r.prefix === ruleKey) || { windowMs: this.defaultRule.windowMs };
      for (const [clientKey, record] of store.entries()) {
        if (now - record.windowStart >= rule.windowMs) {
          store.delete(clientKey);
        }
      }
    }
  }

  reset(): void {
    this.stores.clear();
  }
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  return new RateLimiter(options);
}
