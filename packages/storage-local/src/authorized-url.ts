import crypto from 'node:crypto';
import type { AuthorizedUrlOptions, VerifyMediaAccessParams } from './types.js';
import { assertValidStorageKey } from './local-storage-provider.js';
import { UnauthorizedMediaAccessError } from './errors.js';

/**
 * Generates an authorized, short-lived media access URL signed with HMAC-SHA256.
 * Completely conceals filesystem paths and enforces time-limited expiration (ADR 0012).
 */
export function generateAuthorizedMediaUrl(options: AuthorizedUrlOptions): string {
  assertValidStorageKey(options.key);
  if (!options.secret) {
    throw new UnauthorizedMediaAccessError('Signing secret is required to generate authorized media URL');
  }

  const expiresIn = options.expiresInSeconds ?? 300; // 5 minutes default
  const expires = Math.floor(Date.now() / 1000) + expiresIn;
  const purpose = options.purpose || 'inline';
  const memberId = options.memberId || '';

  const payload = `${options.key}:${expires}:${purpose}:${memberId}`;
  const token = crypto.createHmac('sha256', options.secret).update(payload).digest('hex');

  const baseUrl = (options.baseUrl || '/api/v1/media').replace(/\/$/, '');
  const queryParams = new URLSearchParams({
    token,
    expires: String(expires),
    purpose,
  });

  if (memberId) {
    queryParams.set('memberId', memberId);
  }

  return `${baseUrl}/${options.key}?${queryParams.toString()}`;
}

/**
 * Verifies that a request to access media contains a valid HMAC token and has not expired.
 * Throws UnauthorizedMediaAccessError if invalid or expired.
 */
export function assertAuthorizedMediaAccess(params: VerifyMediaAccessParams): void {
  assertValidStorageKey(params.key);

  const now = Math.floor(Date.now() / 1000);
  if (params.expires < now) {
    throw new UnauthorizedMediaAccessError('Authorized media URL has expired');
  }

  const purpose = params.purpose || 'inline';
  const memberId = params.memberId || '';
  const expectedPayload = `${params.key}:${params.expires}:${purpose}:${memberId}`;
  const expectedToken = crypto.createHmac('sha256', params.secret).update(expectedPayload).digest('hex');

  const providedBuffer = Buffer.from(params.token, 'hex');
  const expectedBuffer = Buffer.from(expectedToken, 'hex');

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new UnauthorizedMediaAccessError('Invalid media authorization token signature');
  }
}

/**
 * Boolean wrapper for assertAuthorizedMediaAccess.
 */
export function isAuthorizedMediaAccess(params: VerifyMediaAccessParams): boolean {
  try {
    assertAuthorizedMediaAccess(params);
    return true;
  } catch {
    return false;
  }
}
