import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTestContext } from './test-helper.js';
import { AuthService } from '../src/auth-service.js';
import { readClaimToken } from '../src/onboarding/claim-token.js';
import { AlreadyClaimedError, InvalidClaimCodeError, WeakPasswordError } from '../src/errors.js';

describe('Initial Onboarding & Claiming (ADR 0006, 0011, 0020)', () => {
  it('generates claim token on first boot and claims installation successfully', () => {
    const ctx = createTestContext();
    try {
      const auth = new AuthService(ctx.db, { dataDir: ctx.dataDir });

      // Before claim: not claimed
      assert.equal(auth.claimService.isClaimed(), false);

      // Boot generates claim token
      const bootToken = auth.claimService.getBootClaimToken();
      assert.ok(bootToken);
      assert.ok(bootToken.startsWith('FLUX-'));

      // File exists on disk
      assert.equal(readClaimToken(ctx.dataDir), bootToken);

      // Attempting claim with invalid code fails
      assert.throws(
        () =>
          auth.claim({
            claimCode: 'INVALID-CODE',
            organizationName: 'Flux Empreendimentos',
            ownerName: 'Rafael Admin',
            ownerEmail: 'admin@flux.com',
            password: 'StrongPassword123!',
            operationalTimezone: 'America/Sao_Paulo',
          }),
        (err: unknown) => err instanceof InvalidClaimCodeError
      );

      // Attempting claim with weak password fails
      assert.throws(
        () =>
          auth.claim({
            claimCode: bootToken,
            organizationName: 'Flux Empreendimentos',
            ownerName: 'Rafael Admin',
            ownerEmail: 'admin@flux.com',
            password: 'short',
            operationalTimezone: 'America/Sao_Paulo',
          }),
        (err: unknown) => err instanceof WeakPasswordError
      );

      // Successful claim
      const response = auth.claim(
        {
          claimCode: bootToken,
          organizationName: 'Flux Empreendimentos',
          ownerName: 'Rafael Admin',
          ownerEmail: 'admin@flux.com',
          password: 'StrongPassword123!',
          operationalTimezone: 'America/Sao_Paulo',
          retentionPolicyDays: {
            messagesDays: 365,
            mediaDays: 90,
            logsDays: 30,
          },
        },
        {
          deviceFingerprint: 'admin-laptop-fingerprint-123',
          deviceName: 'Admin MacBook Pro',
          userAgent: 'Mozilla/5.0 TestBrowser',
          ipAddress: '192.168.1.50',
        }
      );

      assert.ok(response.organizationId);
      assert.ok(response.ownerId);
      assert.ok(response.token);
      assert.ok(response.recoveryKeyGuidance.includes('ADR 0020'));

      // Claim token file is destroyed immediately after claiming
      assert.equal(readClaimToken(ctx.dataDir), null);
      assert.equal(fs.existsSync(path.join(ctx.dataDir, 'claim.token')), false);

      // System is now claimed
      assert.equal(auth.claimService.isClaimed(), true);

      // Token returned can authenticate immediately
      const sessionContext = auth.authenticate(response.token);
      assert.equal(sessionContext.member.id, response.ownerId);
      assert.equal(sessionContext.member.role, 'owner');
      assert.equal(sessionContext.member.email, 'admin@flux.com');
      assert.equal(sessionContext.device.isApproved, true);
      assert.equal(sessionContext.device.deviceIdentifier, 'admin-laptop-fingerprint-123');

      // Attempting to claim a second time fails with AlreadyClaimedError
      assert.throws(
        () =>
          auth.claim({
            claimCode: 'FLUX-ANY-CODE-1234',
            organizationName: 'Second Org Attempt',
            ownerName: 'Second Owner',
            ownerEmail: 'second@flux.com',
            password: 'StrongPassword123!',
            operationalTimezone: 'America/Sao_Paulo',
          }),
        (err: unknown) => err instanceof AlreadyClaimedError
      );
    } finally {
      ctx.cleanup();
    }
  });
});
