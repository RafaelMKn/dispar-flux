import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from './test-helper.js';
import { AuthService } from '../src/auth-service.js';
import { LastOwnerProtectionError, MemberInactiveError } from '../src/errors.js';

describe('Member & Role Management (ADR 0006, 0029)', () => {
  it('creates members and preserves at least one active Owner invariant', () => {
    const ctx = createTestContext();
    try {
      const auth = new AuthService(ctx.db, { dataDir: ctx.dataDir });

      // Claim installation to establish initial organization and first Owner
      const bootToken = auth.claimService.getBootClaimToken()!;
      const claimResult = auth.claim({
        claimCode: bootToken,
        organizationName: 'Acme Corp',
        ownerName: 'Primary Owner',
        ownerEmail: 'owner1@acme.com',
        password: 'Password123!',
        operationalTimezone: 'America/Sao_Paulo',
      });

      const orgId = claimResult.organizationId;
      const owner1Id = claimResult.ownerId;

      // 1. Create an Operator member
      const operator = auth.memberService.createMember({
        organizationId: orgId,
        name: 'Carlos Operator',
        email: 'carlos@acme.com',
        password: 'OperatorPass123!',
        role: 'operator',
        actorId: owner1Id,
      });

      assert.equal(operator.role, 'operator');
      assert.equal(operator.isActive, true);

      // 2. Cannot demote the sole active Owner to Operator (ADR 0029)
      assert.throws(
        () =>
          auth.memberService.updateMember(owner1Id, {
            role: 'operator',
          }),
        (err: unknown) => err instanceof LastOwnerProtectionError
      );

      // 3. Cannot deactivate the sole active Owner (ADR 0029)
      assert.throws(
        () =>
          auth.memberService.updateMember(owner1Id, {
            isActive: false,
          }),
        (err: unknown) => err instanceof LastOwnerProtectionError
      );

      // 4. Create a second Owner (ADR 0029: permite múltiplos proprietários)
      const owner2 = auth.memberService.createMember({
        organizationId: orgId,
        name: 'Second Owner',
        email: 'owner2@acme.com',
        password: 'SecondOwnerPass123!',
        role: 'owner',
        actorId: owner1Id,
      });

      assert.equal(owner2.role, 'owner');
      assert.equal(owner2.isActive, true);

      // 5. With two active owners, demoting or deactivating one owner is allowed
      const demotedOwner = auth.memberService.updateMember(owner2.id, {
        role: 'operator',
      });
      assert.equal(demotedOwner.role, 'operator');

      // Now only owner1 is owner; attempting to deactivate owner1 still fails
      assert.throws(
        () =>
          auth.memberService.updateMember(owner1Id, {
            isActive: false,
          }),
        (err: unknown) => err instanceof LastOwnerProtectionError
      );

      // 6. Deactivating an operator works and revokes sessions
      const deactivatedOperator = auth.memberService.updateMember(operator.id, {
        isActive: false,
      });
      assert.equal(deactivatedOperator.isActive, false);

      // Deactivated member cannot log in
      assert.throws(
        () =>
          auth.login({
            email: 'carlos@acme.com',
            password: 'OperatorPass123!',
            deviceFingerprint: 'dev-1',
          }),
        (err: unknown) => err instanceof MemberInactiveError
      );
    } finally {
      ctx.cleanup();
    }
  });
});
