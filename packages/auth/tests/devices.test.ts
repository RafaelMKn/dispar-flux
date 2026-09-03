import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from './test-helper.js';
import { AuthService } from '../src/auth-service.js';
import { DEVICE_TRUST_DURATION_MS } from '@dispar-flux/domain';
import { ForbiddenError, SessionNotFoundError } from '../src/errors.js';

describe('Authorized Devices & 90-Day Inactivity Trust Expiration (ADR 0011, 0047)', () => {
  it('requires Owner approval for new devices and expires trust after 90 days inactivity', () => {
    const ctx = createTestContext();
    try {
      const auth = new AuthService(ctx.db, { dataDir: ctx.dataDir });

      // Claim installation (initial device authorized automatically)
      const bootToken = auth.claimService.getBootClaimToken()!;
      const claimResult = auth.claim({
        claimCode: bootToken,
        organizationName: 'Device Org',
        ownerName: 'Owner User',
        ownerEmail: 'owner@device.com',
        password: 'Password123!',
        operationalTimezone: 'America/Sao_Paulo',
      });

      const orgId = claimResult.organizationId;
      const ownerId = claimResult.ownerId;

      // 1. Create an operator member
      const operator = auth.memberService.createMember({
        organizationId: orgId,
        name: 'Operator User',
        email: 'operator@device.com',
        password: 'OperatorPass123!',
        role: 'operator',
      });

      // 2. Operator attempts login from an unknown browser (Device 1)
      const loginAttempt1 = auth.login({
        email: 'operator@device.com',
        password: 'OperatorPass123!',
        deviceFingerprint: 'operator-chrome-device-1',
        deviceName: 'Chrome on Operator Workstation',
      });

      // No active session token is issued! requiresDeviceApproval is true
      assert.equal(loginAttempt1.token, '');
      assert.equal(loginAttempt1.requiresDeviceApproval, true);
      assert.ok(loginAttempt1.deviceId);

      // Verify device record is unapproved in database (Access Request)
      const unapprovedDevice = auth.deviceService.getDeviceById(loginAttempt1.deviceId);
      assert.ok(unapprovedDevice);
      assert.equal(unapprovedDevice.isApproved, false);

      // 3. Operator cannot approve devices (ADR 0011 & Master Plan Section 9)
      assert.throws(
        () =>
          auth.handleDeviceApproval(
            { deviceId: loginAttempt1.deviceId, approve: true },
            { id: operator.id, role: 'operator', organizationId: orgId }
          ),
        (err: unknown) => err instanceof ForbiddenError
      );

      // 4. Owner approves the device
      const approvalResult = auth.handleDeviceApproval(
        { deviceId: loginAttempt1.deviceId, approve: true },
        { id: ownerId, role: 'owner', organizationId: orgId }
      );
      assert.equal(approvalResult.isApproved, true);

      // 5. Subsequent login from the approved device now succeeds and issues active session
      const loginSuccess = auth.login({
        email: 'operator@device.com',
        password: 'OperatorPass123!',
        deviceFingerprint: 'operator-chrome-device-1',
      });

      assert.ok(loginSuccess.token);
      assert.equal(loginSuccess.requiresDeviceApproval, false);

      // Authenticating with the token works
      const authCtx = auth.authenticate(loginSuccess.token);
      assert.equal(authCtx.member.id, operator.id);
      assert.equal(authCtx.device.id, loginAttempt1.deviceId);
      assert.equal(authCtx.device.isApproved, true);

      // 6. Test 90-day inactivity trust expiration (ADR 0047)
      // Simulate time advance past 90 days of inactivity (e.g. 91 days later)
      const futureDate = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000);

      // Authenticating session after 90 days fails because device trust expired
      assert.throws(() => auth.authenticate(loginSuccess.token, futureDate));

      // Attempting login after 90 days marks device unapproved and requires re-approval
      const expiredLoginAttempt = auth.login(
        {
          email: 'operator@device.com',
          password: 'OperatorPass123!',
          deviceFingerprint: 'operator-chrome-device-1',
        },
        { now: futureDate }
      );

      assert.equal(expiredLoginAttempt.token, '');
      assert.equal(expiredLoginAttempt.requiresDeviceApproval, true);

      // 7. Revoking device terminates all active sessions (ADR 0047)
      // Re-approve device to establish a new session
      auth.handleDeviceApproval(
        { deviceId: loginAttempt1.deviceId, approve: true },
        { id: ownerId, role: 'owner', organizationId: orgId }
      );

      const freshLogin = auth.login({
        email: 'operator@device.com',
        password: 'OperatorPass123!',
        deviceFingerprint: 'operator-chrome-device-1',
      });
      assert.ok(freshLogin.token);

      // Owner revokes device
      auth.handleDeviceApproval(
        { deviceId: loginAttempt1.deviceId, approve: false },
        { id: ownerId, role: 'owner', organizationId: orgId }
      );

      // Device is now unapproved
      const revokedDevice = auth.deviceService.getDeviceById(loginAttempt1.deviceId);
      assert.equal(revokedDevice?.isApproved, false);

      // The fresh session has been revoked and can no longer authenticate
      assert.throws(() => auth.authenticate(freshLogin.token));
    } finally {
      ctx.cleanup();
    }
  });
});
