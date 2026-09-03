import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from './test-helper.js';
import { AuthService } from '../src/auth-service.js';
import { ForbiddenError, InviteInvalidError } from '../src/errors.js';

describe('Access Invites Lifecycle (ADR 0018)', () => {
  it('allows owner to create single-use invite, authorizes first device upon redemption, and blocks reuse', () => {
    const ctx = createTestContext();
    try {
      const auth = new AuthService(ctx.db, { dataDir: ctx.dataDir });

      // Claim installation
      const bootToken = auth.claimService.getBootClaimToken()!;
      const claimResult = auth.claim({
        claimCode: bootToken,
        organizationName: 'Invites Test Org',
        ownerName: 'Owner Admin',
        ownerEmail: 'owner@invites.com',
        password: 'Password123!',
        operationalTimezone: 'America/Sao_Paulo',
      });

      const orgId = claimResult.organizationId;
      const ownerId = claimResult.ownerId;

      // 1. Non-owners (operators) cannot create invites
      assert.throws(
        () =>
          auth.createInvite(
            { role: 'operator' },
            { id: 'some-operator-id', role: 'operator', organizationId: orgId }
          ),
        (err: unknown) => err instanceof ForbiddenError
      );

      // 2. Owner creates invite (default 48h expiration)
      const inviteResponse = auth.createInvite(
        { role: 'operator', expiresInHours: 48 },
        { id: ownerId, role: 'owner', organizationId: orgId }
      );

      assert.ok(inviteResponse.code.startsWith('inv_'));
      assert.equal(inviteResponse.role, 'operator');
      const expiresAt = new Date(inviteResponse.expiresAt);
      assert.ok(expiresAt.getTime() > Date.now() + 47 * 60 * 60 * 1000);

      // 3. Convidado accepts invite: creates member, authorizes first device, issues session (ADR 0018)
      const acceptResponse = auth.acceptInvite(
        {
          code: inviteResponse.code,
          name: 'Bruna Atendente',
          email: 'bruna@invites.com',
          password: 'BrunaPassword123!',
          deviceFingerprint: 'bruna-browser-chrome-windows',
          deviceName: 'Bruna Work Laptop',
        },
        {
          userAgent: 'Mozilla/5.0 Windows Chrome',
          ipAddress: '200.100.50.25',
        }
      );

      assert.ok(acceptResponse.memberId);
      assert.ok(acceptResponse.deviceId);
      assert.ok(acceptResponse.token);

      // Verify the new member is an Operator and active
      const member = auth.memberService.getMemberById(acceptResponse.memberId);
      assert.ok(member);
      assert.equal(member.role, 'operator');
      assert.equal(member.isActive, true);

      // Verify initial device is authorized immediately
      const device = auth.deviceService.getDeviceById(acceptResponse.deviceId);
      assert.ok(device);
      assert.equal(device.isApproved, true);
      assert.equal(device.deviceIdentifier, 'bruna-browser-chrome-windows');

      // Verify session is active and functional
      const sessionCtx = auth.authenticate(acceptResponse.token);
      assert.equal(sessionCtx.member.id, acceptResponse.memberId);
      assert.equal(sessionCtx.device.id, acceptResponse.deviceId);

      // 4. Invite cannot be used a second time (single-use constraint)
      assert.throws(
        () =>
          auth.acceptInvite({
            code: inviteResponse.code,
            name: 'Another Person',
            email: 'another@invites.com',
            password: 'AnotherPassword123!',
            deviceFingerprint: 'another-device',
          }),
        (err: unknown) => err instanceof InviteInvalidError
      );

      // 5. Expired invite is rejected
      // Create an invite that expired in the past directly in DB
      const pastTime = new Date(Date.now() - 1000).toISOString();
      const expiredCode = 'inv_expired_test_code';
      ctx.db.prepare(`
        INSERT INTO access_invites (id, organization_id, created_by_member_id, code, role, expires_at, created_at)
        VALUES ('expired-id', ?, ?, ?, 'operator', ?, ?)
      `).run(orgId, ownerId, expiredCode, pastTime, pastTime);

      assert.throws(
        () =>
          auth.acceptInvite({
            code: expiredCode,
            name: 'Expired Person',
            email: 'expired@invites.com',
            password: 'Password123!',
            deviceFingerprint: 'dev-expired',
          }),
        (err: unknown) => err instanceof InviteInvalidError
      );
    } finally {
      ctx.cleanup();
    }
  });
});
