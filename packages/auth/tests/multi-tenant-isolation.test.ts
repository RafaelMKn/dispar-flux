import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from './test-helper.js';
import { AuthService } from '../src/auth-service.js';
import { AuthError } from '../src/errors.js';

describe('Auth Multi-Tenant Data Isolation & IDOR Elimination (ADR 0011, ADR 0029, ADR 0047)', () => {
  it('forbids Owner of Tenant B from approving or revoking devices belonging to Tenant A', () => {
    const ctx = createTestContext();
    try {
      const auth = new AuthService(ctx.db, { dataDir: ctx.dataDir });

      // 1. Setup Tenant A
      const bootToken = auth.claimService.getBootClaimToken()!;
      const claimA = auth.claim({
        claimCode: bootToken,
        organizationName: 'Tenant A Corp',
        ownerName: 'Owner Tenant A',
        ownerEmail: 'owner@tenant-a.com',
        password: 'Password123!',
        operationalTimezone: 'America/Sao_Paulo',
      });
      const orgA = claimA.organizationId;
      const ownerA = claimA.ownerId;

      // 2. Setup Tenant B
      const orgB = 'org-tenant-b';
      const now = new Date().toISOString();
      ctx.db.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
        VALUES (?, 'Tenant B Corp', 'America/Sao_Paulo', ?, ?)
      `).run(orgB, now, now);

      const ownerB = auth.memberService.createMember({
        organizationId: orgB,
        name: 'Owner Tenant B',
        email: 'owner@tenant-b.com',
        password: 'PasswordTenantB123!',
        role: 'owner',
      });

      // 3. Create an operator in Tenant A
      const operatorA = auth.memberService.createMember({
        organizationId: orgA,
        name: 'Operator Tenant A',
        email: 'operator@tenant-a.com',
        password: 'OperatorPassA123!',
        role: 'operator',
      });

      // 4. Operator A registers a new unapproved device (Device A)
      const loginAttemptA = auth.login({
        email: 'operator@tenant-a.com',
        password: 'OperatorPassA123!',
        deviceFingerprint: 'operator-a-fingerprint-1',
        deviceName: 'Workstation Operator A',
      });

      assert.equal(loginAttemptA.requiresDeviceApproval, true);
      const deviceAId = loginAttemptA.deviceId;

      // 5. ATTACK: Owner of Tenant B tries to approve Device A belonging to Tenant A (IDOR attempt)
      assert.throws(
        () =>
          auth.deviceService.approveDevice({
            deviceId: deviceAId,
            approvedByMemberId: ownerB.id,
            actorRole: 'owner',
            organizationId: orgB, // Scoped to Tenant B!
          }),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal((err as AuthError).code, 'DEVICE_NOT_FOUND');
          assert.equal((err as AuthError).statusCode, 404);
          return true;
        }
      );

      // Verify device A is STILL unapproved
      const deviceCheck = auth.deviceService.getDeviceById(deviceAId, orgA);
      assert.ok(deviceCheck);
      assert.equal(deviceCheck.isApproved, false);

      // 6. ATTACK: Owner of Tenant B tries to revoke Device A
      assert.throws(
        () =>
          auth.deviceService.revokeDevice({
            deviceId: deviceAId,
            actorId: ownerB.id,
            actorRole: 'owner',
            organizationId: orgB,
          }),
        (err: unknown) => {
          assert.ok(err instanceof AuthError);
          assert.equal((err as AuthError).code, 'DEVICE_NOT_FOUND');
          assert.equal((err as AuthError).statusCode, 404);
          return true;
        }
      );

      // 7. Legitimate Owner A approves Device A
      const approved = auth.deviceService.approveDevice({
        deviceId: deviceAId,
        approvedByMemberId: ownerA,
        actorRole: 'owner',
        organizationId: orgA,
      });

      assert.equal(approved.isApproved, true);

      // Operator A can now login successfully
      const loginSuccess = auth.login({
        email: 'operator@tenant-a.com',
        password: 'OperatorPassA123!',
        deviceFingerprint: 'operator-a-fingerprint-1',
      });
      assert.ok(loginSuccess.token);
      assert.equal(loginSuccess.requiresDeviceApproval, false);
    } finally {
      ctx.cleanup();
    }
  });
});
