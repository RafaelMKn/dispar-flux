import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createCorsHandler,
  createSecureHeadersHandler,
  createRateLimiter,
  createCsrfProtection,
  createSizeLimitHandler,
  sanitizeLogString,
  sanitizeLogObject,
  SanitizedLogger,
  PayloadTooLargeError,
} from '../src/index.js';

describe('Security Hardening Package (@dispar-flux/security)', () => {
  describe('Strict CORS Configuration', () => {
    it('allows permitted origin and sets correct CORS response headers', () => {
      const cors = createCorsHandler({
        allowedOrigins: ['https://flux.example.com'],
      });

      const req = {
        headers: { origin: 'https://flux.example.com' },
        method: 'GET',
      } as unknown as IncomingMessage;

      const headers: Record<string, string> = {};
      const res = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
      } as unknown as ServerResponse;

      const handled = cors.handle(req, res);
      assert.equal(handled, false);
      assert.equal(headers['Access-Control-Allow-Origin'], 'https://flux.example.com');
      assert.equal(headers['Access-Control-Allow-Credentials'], 'true');
      assert.equal(headers['Vary'], 'Origin');
    });

    it('rejects unallowed origin on OPTIONS preflight with 403 Forbidden', () => {
      const cors = createCorsHandler({
        allowedOrigins: ['https://flux.example.com'],
      });

      let ended = false;
      let statusCode = 200;
      const headers: Record<string, string> = {};

      const req = {
        headers: { origin: 'https://malicious.example.com' },
        method: 'OPTIONS',
      } as unknown as IncomingMessage;

      const res = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        set statusCode(code: number) {
          statusCode = code;
        },
        end: () => {
          ended = true;
        },
      } as unknown as ServerResponse;

      const handled = cors.handle(req, res);
      assert.equal(handled, true);
      assert.equal(statusCode, 403);
      assert.equal(ended, true);
      assert.equal(headers['Access-Control-Allow-Origin'], undefined);
    });

    it('handles allowed OPTIONS preflight returning 204 with allowed methods and headers', () => {
      const cors = createCorsHandler({
        allowedOrigins: ['https://flux.example.com'],
      });

      let ended = false;
      let statusCode = 200;
      const headers: Record<string, string> = {};

      const req = {
        headers: { origin: 'https://flux.example.com' },
        method: 'OPTIONS',
      } as unknown as IncomingMessage;

      const res = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        set statusCode(code: number) {
          statusCode = code;
        },
        end: () => {
          ended = true;
        },
      } as unknown as ServerResponse;

      const handled = cors.handle(req, res);
      assert.equal(handled, true);
      assert.equal(statusCode, 204);
      assert.equal(ended, true);
      assert.ok(headers['Access-Control-Allow-Methods'].includes('POST'));
      assert.ok(headers['Access-Control-Allow-Headers'].includes('Content-Type'));
      assert.ok(headers['Access-Control-Allow-Headers'].includes('X-CSRF-Token'));
    });
  });

  describe('Secure HTTP Headers & Content Security Policy (ADR 0049)', () => {
    it('sets CSP, X-Content-Type-Options, X-Frame-Options, and Strict-Transport-Security', () => {
      const handler = createSecureHeadersHandler();

      const headers: Record<string, string> = {};
      const res = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
      } as unknown as ServerResponse;

      handler.apply({} as IncomingMessage, res);

      assert.equal(headers['X-Content-Type-Options'], 'nosniff');
      assert.equal(headers['X-Frame-Options'], 'DENY');
      assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
      assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
      assert.ok(headers['Content-Security-Policy'].includes("default-src 'self'"));
      assert.ok(headers['Content-Security-Policy'].includes("frame-ancestors 'none'"));
      assert.ok(headers['Strict-Transport-Security'].includes('max-age=31536000'));
      assert.ok(headers['Strict-Transport-Security'].includes('includeSubDomains'));
    });
  });

  describe('Endpoint-Specific Rate Limiting', () => {
    it('enforces stricter limits on /auth/login and triggers 429 when exceeded', () => {
      const limiter = createRateLimiter({
        rules: [{ prefix: '/api/v1/auth/login', maxRequests: 3, windowMs: 10_000 }],
      });

      const req = {
        url: '/api/v1/auth/login',
        headers: {},
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      // 1st request
      let check = limiter.check(req);
      assert.equal(check.allowed, true);
      assert.equal(check.remaining, 2);

      // 2nd request
      check = limiter.check(req);
      assert.equal(check.allowed, true);
      assert.equal(check.remaining, 1);

      // 3rd request
      check = limiter.check(req);
      assert.equal(check.allowed, true);
      assert.equal(check.remaining, 0);

      // 4th request -> Exceeded!
      check = limiter.check(req);
      assert.equal(check.allowed, false);
      assert.equal(check.remaining, 0);
      assert.ok(check.resetSeconds > 0);

      // Middleware handles response with 429 and Retry-After
      let statusCode = 200;
      const headers: Record<string, string> = {};
      let body = '';
      const res = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        set statusCode(code: number) {
          statusCode = code;
        },
        end: (data: string) => {
          body = data;
        },
      } as unknown as ServerResponse;

      const blocked = limiter.handle(req, res);
      assert.equal(blocked, true);
      assert.equal(statusCode, 429);
      assert.ok(headers['Retry-After']);
      assert.ok(JSON.parse(body).error.includes('Too Many Requests'));
    });

    it('isolates different clients by IP', () => {
      const limiter = createRateLimiter({
        rules: [{ prefix: '/test', maxRequests: 1, windowMs: 10_000 }],
      });

      const reqA = {
        url: '/test',
        headers: { 'x-forwarded-for': '10.0.0.1' },
        socket: {},
      } as unknown as IncomingMessage;

      const reqB = {
        url: '/test',
        headers: { 'x-forwarded-for': '10.0.0.2' },
        socket: {},
      } as unknown as IncomingMessage;

      assert.equal(limiter.check(reqA).allowed, true);
      assert.equal(limiter.check(reqA).allowed, false);

      // Different IP should still be allowed
      assert.equal(limiter.check(reqB).allowed, true);
    });
  });

  describe('CSRF Protection for Cookie-Based Sessions', () => {
    it('allows safe methods (GET, HEAD, OPTIONS) without CSRF token', () => {
      const csrf = createCsrfProtection();
      const req = {
        method: 'GET',
        headers: { cookie: 'df_session=session_123' },
      } as unknown as IncomingMessage;

      assert.equal(csrf.isValid(req), true);
    });

    it('exempts API requests with Bearer token authentication from CSRF check', () => {
      const csrf = createCsrfProtection();
      const req = {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret_token_xyz',
        },
      } as unknown as IncomingMessage;

      assert.equal(csrf.isValid(req), true);
    });

    it('rejects state-changing requests when session cookie exists but CSRF token is missing or mismatched', () => {
      const csrf = createCsrfProtection();
      const req = {
        method: 'POST',
        headers: {
          cookie: 'df_session=sess_1; df_csrf=token_valid_123',
          'x-csrf-token': 'wrong_token',
        },
      } as unknown as IncomingMessage;

      assert.equal(csrf.isValid(req), false);

      let statusCode = 200;
      const res = {
        getHeader: () => undefined,
        setHeader: () => {},
        set statusCode(c: number) {
          statusCode = c;
        },
        end: () => {},
      } as unknown as ServerResponse;

      const rejected = csrf.handle(req, res);
      assert.equal(rejected, true);
      assert.equal(statusCode, 403);
    });

    it('accepts state-changing request when X-CSRF-Token matches the df_csrf cookie', () => {
      const csrf = createCsrfProtection();
      const token = csrf.generateToken();
      const req = {
        method: 'POST',
        headers: {
          cookie: `df_session=sess_1; df_csrf=${token}`,
          'x-csrf-token': token,
        },
      } as unknown as IncomingMessage;

      assert.equal(csrf.isValid(req), true);
    });
  });

  describe('Body & Upload Size Limits (Prevent DOS)', () => {
    it('fast-rejects requests when Content-Length exceeds limit with 413 Payload Too Large', () => {
      const handler = createSizeLimitHandler({
        defaultLimitBytes: 1024, // 1 KB
      });

      const req = {
        url: '/api/v1/contacts',
        headers: {
          'content-length': '2048', // 2 KB -> exceeds 1 KB
        },
      } as unknown as IncomingMessage;

      let statusCode = 200;
      const headers: Record<string, string> = {};
      let body = '';

      const res = {
        setHeader: (k: string, v: string) => {
          headers[k] = v;
        },
        set statusCode(code: number) {
          statusCode = code;
        },
        end: (data: string) => {
          body = data;
        },
      } as unknown as ServerResponse;

      const blocked = handler.checkContentLength(req, res);
      assert.equal(blocked, true);
      assert.equal(statusCode, 413);
      assert.ok(JSON.parse(body).error.includes('Payload Too Large'));
    });

    it('allows larger payloads on designated upload routes', () => {
      const handler = createSizeLimitHandler({
        defaultLimitBytes: 1024,
        uploadLimitBytes: 10 * 1024 * 1024,
      });

      assert.equal(handler.resolveLimit('/api/v1/contacts'), 1024);
      assert.equal(handler.resolveLimit('/api/v1/migration/upload'), 10 * 1024 * 1024);
      assert.equal(handler.resolveLimit('/api/v1/backup/restore'), 10 * 1024 * 1024);
    });
  });

  describe('PII Sanitization Filter for Application Logs (ADR 0050)', () => {
    it('redacts Brazilian mobile and landline phone numbers from log strings', () => {
      const input = 'Contact +55 11 98765-4321 sent a message. Another contact: (21) 9988-7766 and 11999998888.';
      const sanitized = sanitizeLogString(input);

      assert.ok(!sanitized.includes('98765-4321'));
      assert.ok(!sanitized.includes('9988-7766'));
      assert.ok(!sanitized.includes('11999998888'));
      assert.ok(sanitized.includes('[REDACTED_PHONE]'));
    });

    it('redacts email addresses from log strings', () => {
      const input = 'User owner@disparflux.org requested session creation';
      const sanitized = sanitizeLogString(input);

      assert.ok(!sanitized.includes('owner@disparflux.org'));
      assert.ok(sanitized.includes('[REDACTED_EMAIL]'));
    });

    it('redacts sensitive fields in structured log objects (names, messages, passwords, tokens)', () => {
      const obj = {
        requestId: 'req_12345',
        statusCode: 200,
        contactName: 'Carlos Silva',
        normalizedPhone: '+5511999998888',
        messageTemplate: 'Olá Carlos, confira nossa oferta especial!',
        passwordHash: '$scrypt$n=16384$secret_hash',
        token: 'raw_auth_token_xyz',
        claimCode: 'FLUX-A1B2-C3D4-E5F6',
        recoveryKey: 'rec_secret_key_123',
      };

      const sanitized = sanitizeLogObject(obj);

      // Technical identifiers preserved
      assert.equal(sanitized.requestId, 'req_12345');
      assert.equal(sanitized.statusCode, 200);

      // PII and secrets redacted
      assert.equal(sanitized.contactName, '[REDACTED_NAME]');
      assert.equal(sanitized.normalizedPhone, '[REDACTED_PHONE]');
      assert.equal(sanitized.messageTemplate, '[REDACTED_MESSAGE]');
      assert.equal(sanitized.passwordHash, '[REDACTED_SECRET]');
      assert.equal(sanitized.token, '[REDACTED_SECRET]');
      assert.equal(sanitized.claimCode, '[REDACTED_SECRET]');
      assert.equal(sanitized.recoveryKey, '[REDACTED_SECRET]');
    });

    it('SanitizedLogger emits structured log entry without PII', () => {
      const logger = new SanitizedLogger('TestLogger');
      const entry = logger.info('Message sent to 11999998888', {
        name: 'Maria Oliveira',
        phone: '11999998888',
        content: 'Oi Maria, tudo bem?',
        channelId: 'conn_1',
      });

      assert.equal(entry.level, 'info');
      assert.ok(!entry.message.includes('11999998888'));
      assert.ok(entry.message.includes('[REDACTED_PHONE]'));
      assert.equal(entry.context?.name, '[REDACTED_NAME]');
      assert.equal(entry.context?.phone, '[REDACTED_PHONE]');
      assert.equal(entry.context?.content, '[REDACTED_MESSAGE]');
      assert.equal(entry.context?.channelId, 'conn_1');
    });
  });
});
