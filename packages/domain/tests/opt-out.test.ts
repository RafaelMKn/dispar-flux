import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOptOut,
  reauthorizeOptOut,
  createSuppressionKey,
  generateSuppressionHash,
  canSendAutomatedMessage,
  assertCanSendAutomatedMessage,
  OptOutViolationError,
  ReauthorizationError,
} from '../src/index.js';

describe('Opt-Out & Suppression Invariants (ADR 0040, ADR 0044, ADR 0045)', () => {
  const TEST_PHONE = '+5511987654321';
  const OTHER_PHONE = '+5511912345678';
  const ORG_SALT = 'super-secret-org-salt-1234';

  describe('Organization-wide Opt-out (ADR 0040)', () => {
    it('blocks automated sends across the entire organization', () => {
      const optOut = createOptOut({
        id: 'opt-1',
        organizationId: 'org-1',
        normalizedPhone: TEST_PHONE,
        reason: 'Solicitou parada via mensagem "PARAR"',
      });

      const checkOptedOut = canSendAutomatedMessage({
        normalizedPhone: TEST_PHONE,
        optOuts: [optOut],
      });

      assert.equal(checkOptedOut.eligible, false);
      assert.equal(checkOptedOut.reason, 'opted_out');
      assert.ok(checkOptedOut.details?.includes(TEST_PHONE));

      assert.throws(
        () =>
          assertCanSendAutomatedMessage({
            normalizedPhone: TEST_PHONE,
            optOuts: [optOut],
          }),
        OptOutViolationError
      );

      // Other numbers remain eligible
      const checkOther = canSendAutomatedMessage({
        normalizedPhone: OTHER_PHONE,
        optOuts: [optOut],
      });
      assert.equal(checkOther.eligible, true);
    });
  });

  describe('Traceable Reauthorization (ADR 0045)', () => {
    it('requires member actor ID and justification to reauthorize', () => {
      const optOut = createOptOut({
        id: 'opt-1',
        organizationId: 'org-1',
        normalizedPhone: TEST_PHONE,
      });

      // Missing member actor ID throws
      assert.throws(
        () =>
          reauthorizeOptOut(optOut, {
            reauthorizedByMemberId: '',
            reauthorizationReason: 'Cliente ligou pedindo reativação',
          }),
        ReauthorizationError
      );

      // Short justification (<5 chars) throws
      assert.throws(
        () =>
          reauthorizeOptOut(optOut, {
            reauthorizedByMemberId: 'mem-1',
            reauthorizationReason: 'ok',
          }),
        ReauthorizationError
      );

      // Valid reauthorization
      const reauthorized = reauthorizeOptOut(optOut, {
        reauthorizedByMemberId: 'mem-1',
        reauthorizationReason: 'Cliente solicitou retorno por email corporativo com termo assinado',
      });

      assert.ok(reauthorized.reauthorizedAt);
      assert.equal(reauthorized.reauthorizedByMemberId, 'mem-1');

      // Now sending is eligible again
      const check = canSendAutomatedMessage({
        normalizedPhone: TEST_PHONE,
        optOuts: [reauthorized],
      });
      assert.equal(check.eligible, true);
    });

    it('cannot reauthorize an already reauthorized opt-out', () => {
      const optOut = createOptOut({
        id: 'opt-1',
        organizationId: 'org-1',
        normalizedPhone: TEST_PHONE,
      });

      const first = reauthorizeOptOut(optOut, {
        reauthorizedByMemberId: 'mem-1',
        reauthorizationReason: 'Autorizado novamente',
      });

      assert.throws(
        () =>
          reauthorizeOptOut(first, {
            reauthorizedByMemberId: 'mem-1',
            reauthorizationReason: 'Segunda tentativa',
          }),
        ReauthorizationError
      );
    });
  });

  describe('Pseudonymous Suppression Keys (ADR 0044)', () => {
    it('generates deterministic SHA-256 suppression hash and prevents sends', () => {
      const hash1 = generateSuppressionHash(TEST_PHONE, ORG_SALT);
      const hash2 = generateSuppressionHash(TEST_PHONE, ORG_SALT);
      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64); // SHA-256 hex string

      const suppressionKey = createSuppressionKey({
        id: 'sk-1',
        organizationId: 'org-1',
        normalizedPhone: TEST_PHONE,
        salt: ORG_SALT,
      });

      assert.equal(suppressionKey.hashKey, hash1);

      // Even without an active contact entity or opt-out record, suppression key blocks automated message!
      const checkSuppressed = canSendAutomatedMessage({
        normalizedPhone: TEST_PHONE,
        optOuts: [], // Empty opt-outs
        suppressionKeys: [suppressionKey],
        suppressionSalt: ORG_SALT,
      });

      assert.equal(checkSuppressed.eligible, false);
      assert.equal(checkSuppressed.reason, 'suppressed');

      assert.throws(
        () =>
          assertCanSendAutomatedMessage({
            normalizedPhone: TEST_PHONE,
            optOuts: [],
            suppressionKeys: [suppressionKey],
            suppressionSalt: ORG_SALT,
          }),
        OptOutViolationError
      );
    });
  });
});
