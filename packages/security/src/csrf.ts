import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';

export interface CsrfOptions {
  cookieName?: string;
  headerName?: string;
  sessionCookieName?: string;
  isProduction?: boolean;
}

export class CsrfProtection {
  public readonly cookieName: string;
  public readonly headerName: string;
  public readonly sessionCookieName: string;
  public readonly isProduction: boolean;

  constructor(options: CsrfOptions = {}) {
    this.cookieName = options.cookieName ?? 'df_csrf';
    this.headerName = options.headerName ?? 'x-csrf-token';
    this.sessionCookieName = options.sessionCookieName ?? 'df_session';
    this.isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  }

  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  parseCookies(req: IncomingMessage): Record<string, string> {
    const header = req.headers['cookie'];
    if (!header || typeof header !== 'string') return {};

    const cookies: Record<string, string> = {};
    const pairs = header.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const key = pair.substring(0, idx).trim();
        const val = pair.substring(idx + 1).trim();
        cookies[key] = decodeURIComponent(val);
      }
    }
    return cookies;
  }

  /**
   * Sets or refreshes the CSRF token cookie on the response if not already present.
   */
  ensureCookie(req: IncomingMessage, res: ServerResponse): string {
    const cookies = this.parseCookies(req);
    let token = cookies[this.cookieName];

    if (!token) {
      token = this.generateToken();
      const secureFlag = this.isProduction ? '; Secure' : '';
      const cookieHeader = `${this.cookieName}=${encodeURIComponent(token)}; Path=/; SameSite=Strict${secureFlag}`;
      
      const existing = res.getHeader('Set-Cookie');
      if (Array.isArray(existing)) {
        res.setHeader('Set-Cookie', [...existing, cookieHeader]);
      } else if (existing) {
        res.setHeader('Set-Cookie', [existing.toString(), cookieHeader]);
      } else {
        res.setHeader('Set-Cookie', cookieHeader);
      }
    }

    return token;
  }

  /**
   * Validates CSRF token for state-changing HTTP methods.
   * Exemption: Bearer token in Authorization header (pure API client calls).
   * Enforced: Cookie-based sessions on POST, PUT, PATCH, DELETE.
   */
  isValid(req: IncomingMessage): boolean {
    const method = req.method?.toUpperCase() || 'GET';
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

    if (safeMethods.includes(method)) {
      return true;
    }

    // Pure API calls with Bearer token authentication are inherently immune to CSRF
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return true;
    }

    const cookies = this.parseCookies(req);
    // If there is no cookie session, request is not vulnerable to cookie-session CSRF
    const hasSessionCookie = Boolean(cookies[this.sessionCookieName]);
    const expectedToken = cookies[this.cookieName];

    // If there is a session cookie or a CSRF cookie was set
    if (!hasSessionCookie && !expectedToken) {
      return true;
    }

    if (!expectedToken) {
      return false;
    }

    const providedToken = req.headers[this.headerName.toLowerCase()];
    if (!providedToken || typeof providedToken !== 'string') {
      return false;
    }

    const bufExpected = Buffer.from(expectedToken);
    const bufProvided = Buffer.from(providedToken.trim());

    if (bufExpected.length !== bufProvided.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufExpected, bufProvided);
  }

  /**
   * Middleware handler: ensures cookie is present, and rejects state-changing requests if CSRF check fails.
   * Returns true if request was rejected with 403 Forbidden.
   */
  handle(req: IncomingMessage, res: ServerResponse): boolean {
    this.ensureCookie(req, res);

    if (!this.isValid(req)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Forbidden',
          message: 'Invalid or missing CSRF token in X-CSRF-Token header',
        })
      );
      return true;
    }

    return false;
  }
}

export function createCsrfProtection(options: CsrfOptions = {}): CsrfProtection {
  return new CsrfProtection(options);
}
