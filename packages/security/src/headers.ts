import type { IncomingMessage, ServerResponse } from 'node:http';

export interface SecureHeadersOptions {
  csp?: string;
  hstsMaxAge?: number;
  hstsIncludeSubdomains?: boolean;
  hstsPreload?: boolean;
  frameGuard?: 'DENY' | 'SAMEORIGIN';
  referrerPolicy?: string;
  enableHsts?: boolean;
}

export const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' wss: ws:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export class SecureHeadersHandler {
  private readonly csp: string;
  private readonly hstsHeaderValue: string;
  private readonly frameGuard: string;
  private readonly referrerPolicy: string;
  private readonly enableHsts: boolean;

  constructor(options: SecureHeadersOptions = {}) {
    this.csp = options.csp ?? DEFAULT_CSP;
    this.frameGuard = options.frameGuard ?? 'DENY';
    this.referrerPolicy = options.referrerPolicy ?? 'strict-origin-when-cross-origin';
    this.enableHsts = options.enableHsts ?? true;

    const maxAge = options.hstsMaxAge ?? 31536000; // 1 year
    const subdomains = options.hstsIncludeSubdomains !== false ? '; includeSubDomains' : '';
    const preload = options.hstsPreload !== false ? '; preload' : '';
    this.hstsHeaderValue = `max-age=${maxAge}${subdomains}${preload}`;
  }

  apply(req: IncomingMessage, res: ServerResponse): void {
    // Content Security Policy
    res.setHeader('Content-Security-Policy', this.csp);

    // Prevent MIME-sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Clickjacking protection
    res.setHeader('X-Frame-Options', this.frameGuard);

    // Referrer policy
    res.setHeader('Referrer-Policy', this.referrerPolicy);

    // Cross-origin policies
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // Permissions policy
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

    // HTTP Strict Transport Security (HSTS)
    if (this.enableHsts) {
      res.setHeader('Strict-Transport-Security', this.hstsHeaderValue);
    }
  }
}

export function createSecureHeadersHandler(options: SecureHeadersOptions = {}): SecureHeadersHandler {
  return new SecureHeadersHandler(options);
}
