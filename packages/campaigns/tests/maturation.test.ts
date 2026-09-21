import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MaturationService,
  getPolicyForDay,
  MATURATION_STAGES,
} from '../src/maturation/maturation-service.js';
import {
  ConnectionNotFoundError,
  MaturationFrozenError,
  MaturationLimitExceededError,
} from '../src/errors.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('Maturation & 21-Day Warm-up Service (Issue #2 / ADR 0026)', () => {
  let ctx: SeededTestContext;
  let maturationService: MaturationService;

  beforeEach(() => {
    ctx = createTestDatabase();
    maturationService = new MaturationService(ctx.conn);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('Policy by Day calculation', () => {
    it('returns Birth stage policy for days 1 to 3', () => {
      for (let day = 1; day <= 3; day++) {
        const policy = getPolicyForDay(day);
        assert.equal(policy.stage, 'birth');
        assert.equal(policy.dailyCap, 0);
        assert.equal(policy.minPacingSeconds, 60);
        assert.equal(policy.requiresSpintaxOrAi, false);
      }
    });

    it('returns Activation stage policy for days 4 to 7', () => {
      for (let day = 4; day <= 7; day++) {
        const policy = getPolicyForDay(day);
        assert.equal(policy.stage, 'activation');
        assert.equal(policy.dailyCap, 25);
        assert.equal(policy.minPacingSeconds, 45);
        assert.equal(policy.requiresSpintaxOrAi, false);
      }
    });

    it('returns Expansion stage policy for days 8 to 14', () => {
      for (let day = 8; day <= 14; day++) {
        const policy = getPolicyForDay(day);
        assert.equal(policy.stage, 'expansion');
        assert.equal(policy.dailyCap, 60);
        assert.equal(policy.minPacingSeconds, 30);
        assert.equal(policy.requiresSpintaxOrAi, true);
      }
    });

    it('returns Consolidation stage policy for days 15 to 21', () => {
      for (let day = 15; day <= 21; day++) {
        const policy = getPolicyForDay(day);
        assert.equal(policy.stage, 'consolidation');
        assert.equal(policy.dailyCap, 120);
        assert.equal(policy.minPacingSeconds, 20);
        assert.equal(policy.requiresSpintaxOrAi, false);
      }
    });

    it('returns Nominal stage policy for days 22 and beyond', () => {
      const policy = getPolicyForDay(22);
      assert.equal(policy.stage, 'nominal');
      assert.equal(policy.dailyCap, 1000);
      assert.equal(policy.minPacingSeconds, 15);
      assert.equal(policy.requiresSpintaxOrAi, false);

      const policyFar = getPolicyForDay(100);
      assert.equal(policyFar.stage, 'nominal');
    });
  });

  describe('State initialization and retrieval', () => {
    it('initializes state on Day 1 (birth stage) when none exists', () => {
      const state = maturationService.getOrCreateState(ctx.connectionId);
      assert.equal(state.connectionId, ctx.connectionId);
      assert.equal(state.currentDay, 1);
      assert.equal(state.stage, 'birth');
      assert.equal(state.dailyCap, 0);
      assert.equal(state.sentToday, 0);
      assert.equal(state.reportCount24h, 0);
      assert.equal(state.isFrozen, false);
      assert.equal(state.requiresSpintaxOrAi, false);
    });

    it('returns the same persisted state on subsequent calls', () => {
      const state1 = maturationService.getOrCreateState(ctx.connectionId);
      const state2 = maturationService.getOrCreateState(ctx.connectionId);
      assert.equal(state1.connectionId, state2.connectionId);
      assert.equal(state1.currentDay, state2.currentDay);
      assert.equal(state1.createdAt.toISOString(), state2.createdAt.toISOString());
    });

    it('throws ConnectionNotFoundError if connection does not exist in DB', () => {
      assert.throws(
        () => maturationService.getOrCreateState('conn-nonexistent'),
        ConnectionNotFoundError
      );
    });
  });

  describe('Validation of automated send permission (canSendAutomated)', () => {
    it('blocks automated sending during Birth stage (days 1-3)', () => {
      const check = maturationService.canSendAutomated(ctx.connectionId);
      assert.equal(check.allowed, false);
      assert.equal(check.stage, 'birth');
      assert.equal(check.dailyCap, 0);
      assert.match(check.reason ?? '', /Fase 1 \(Nascimento/);
    });

    it('allows automated sending in Activation stage (day 4) up to daily cap', () => {
      maturationService.setDay(ctx.connectionId, 4);
      const check = maturationService.canSendAutomated(ctx.connectionId);
      assert.equal(check.allowed, true);
      assert.equal(check.stage, 'activation');
      assert.equal(check.dailyCap, 25);
      assert.equal(check.remainingToday, 25);
    });

    it('blocks sending when daily cap is exceeded', () => {
      maturationService.setDay(ctx.connectionId, 4); // cap = 25
      for (let i = 0; i < 25; i++) {
        maturationService.recordSend(ctx.connectionId);
      }

      const check = maturationService.canSendAutomated(ctx.connectionId);
      assert.equal(check.allowed, false);
      assert.equal(check.remainingToday, 0);
      assert.match(check.reason ?? '', /Cota diária de maturação atingida/);

      assert.throws(
        () => maturationService.recordSend(ctx.connectionId),
        MaturationLimitExceededError
      );
    });

    it('resets daily usage without changing stage or day', () => {
      maturationService.setDay(ctx.connectionId, 5);
      maturationService.recordSend(ctx.connectionId);
      let state = maturationService.getOrCreateState(ctx.connectionId);
      assert.equal(state.sentToday, 1);

      maturationService.resetDailyUsage(ctx.connectionId);
      state = maturationService.getOrCreateState(ctx.connectionId);
      assert.equal(state.sentToday, 0);
      assert.equal(state.currentDay, 5);
      assert.equal(state.stage, 'activation');
    });
  });

  describe('Incident recording and safety freeze', () => {
    it('increments report_count_24h on incident and freezes at >= 2', () => {
      maturationService.setDay(ctx.connectionId, 10); // expansion, cap 60

      const r1 = maturationService.recordIncident(ctx.connectionId, 'complaint');
      assert.equal(r1.reportCount24h, 1);
      assert.equal(r1.isFrozen, false);

      const check1 = maturationService.canSendAutomated(ctx.connectionId);
      assert.equal(check1.allowed, true);
      assert.equal(check1.isFrozen, false);

      // Second incident triggers immediate safety freeze
      const r2 = maturationService.recordIncident(ctx.connectionId, 'block');
      assert.equal(r2.reportCount24h, 2);
      assert.equal(r2.isFrozen, true);

      const check2 = maturationService.canSendAutomated(ctx.connectionId);
      assert.equal(check2.allowed, false);
      assert.equal(check2.isFrozen, true);
      assert.match(check2.reason ?? '', /congelada preventivamente/);

      assert.throws(
        () => maturationService.recordSend(ctx.connectionId),
        MaturationFrozenError
      );
    });

    it('unfreezes connection when incidents are reset', () => {
      maturationService.setDay(ctx.connectionId, 10);
      maturationService.recordIncident(ctx.connectionId, 'complaint');
      maturationService.recordIncident(ctx.connectionId, 'complaint');

      assert.equal(maturationService.getOrCreateState(ctx.connectionId).isFrozen, true);

      maturationService.resetIncidents(ctx.connectionId);
      const state = maturationService.getOrCreateState(ctx.connectionId);
      assert.equal(state.reportCount24h, 0);
      assert.equal(state.isFrozen, false);

      const check = maturationService.canSendAutomated(ctx.connectionId);
      assert.equal(check.allowed, true);
    });
  });

  describe('Progression through stages', () => {
    it('advances day and updates policies correctly', () => {
      const s1 = maturationService.advanceDay(ctx.connectionId, 3); // day 1 + 3 = 4 (activation)
      assert.equal(s1.currentDay, 4);
      assert.equal(s1.stage, 'activation');
      assert.equal(s1.dailyCap, 25);

      const s2 = maturationService.advanceDay(ctx.connectionId, 4); // day 4 + 4 = 8 (expansion)
      assert.equal(s2.currentDay, 8);
      assert.equal(s2.stage, 'expansion');
      assert.equal(s2.dailyCap, 60);
      assert.equal(s2.requiresSpintaxOrAi, true);

      const s3 = maturationService.setDay(ctx.connectionId, 15); // consolidation
      assert.equal(s3.currentDay, 15);
      assert.equal(s3.stage, 'consolidation');
      assert.equal(s3.dailyCap, 120);

      const s4 = maturationService.setDay(ctx.connectionId, 25); // nominal
      assert.equal(s4.currentDay, 25);
      assert.equal(s4.stage, 'nominal');
      assert.equal(s4.dailyCap, 1000);
      assert.equal(s4.minPacingSeconds, 15);
    });
  });
});
