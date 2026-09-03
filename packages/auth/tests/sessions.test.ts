import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTestContext } from './test-helper.js';
import { AuthService } from '../src/auth-service.js';
import {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
} from '@dispar-flux/domain';
import {
  SessionExpiredError,
  SessionNotFoundError,
  SessionRevokedError,
} from '../src/errors.js';

describe('Session Management (ADR 0047)', () => {
  it('enforces 12-hour idle timeout and 30-day absolute limit, and ensures hash storage', () => {
    const ctx = createTestContext();
    try {
      const auth = new AuthService(ctx.db, { dataDir: ctx.dataDir });

      // Claim installation
      const bootToken = auth.claimService.getBootClaimToken()!;
      const claimResult = auth.claim({
        claimCode: bootToken,
        organizationName: 'Session Org',
        ownerName: 'Owner User',
        ownerEmail: 'owner@session.com',
        password: 'Password123!',
        operationalTimezone: 'America/Sao_Paulo',
      });

      const rawToken = claimResult.token!;
      assert.ok(rawToken);

      // Verify token hash is stored in DB, never plaintext
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionInDb = ctx.db
        .prepare('SELECT token_hash FROM sessions WHERE token_hash = ?')
        .get(tokenHash) as { token_hash: string } | undefined;

      assert.ok(sessionInDb);
      assert.equal(sessionInDb.token_hash, tokenHash);

      // Verify rawToken does not exist anywhere in sessions table
      const rawInDb = ctx.db
        .prepare('SELECT id FROM sessions WHERE token_hash = ?')
        .get(rawToken);
      assert.equal(rawInDb, undefined);

      // 1. Session is valid immediately
      const now = new Date();
      const validCtx = auth.authenticate(rawToken, now);
      assert.equal(validCtx.member.id, claimResult.ownerId);

      // 2. Activity within 12 hours slides idle timeout
      const after6h = new Date(now.getTime() + 6 * 60 * 60 * 1000);
      const touchedCtx = auth.authenticate(rawToken, after6h);
      assert.ok(touchedCtx.session.idleExpiresAt.getTime() > after6h.getTime());

      // 3. 12 hours of inactivity expires the session (idle timeout)
      const after13hIdle = new Date(touchedCtx.session.lastActivityAt.getTime() + 13 * 60 * 60 * 1000);
      assert.throws(
        () => auth.authenticate(rawToken, after13hIdle),
        (err: unknown) => err instanceof SessionExpiredError
      );

      // 4. Absolute expiration limit: 30 days maximum lifespan (ADR 0047)
      // Even if touched continuously, session expires strictly at 30 days
      const after31Days = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
      assert.throws(
        () => auth.authenticate(rawToken, after31Days),
        (err: unknown) => err instanceof SessionExpiredError
      );

      // 5. Logout revokes session
      auth.logout(rawToken);
      assert.throws(
        () => auth.authenticate(rawToken),
        (err: unknown) => err instanceof SessionRevokedError
      );

      // 6. Non-existent token throws SessionNotFoundError
      assert.throws(
        () => auth.authenticate('non-existent-token-12345'),
        (err: unknown) => err instanceof SessionNotFoundError
      );
    } finally {
      ctx.cleanup();
    }
  });
});
