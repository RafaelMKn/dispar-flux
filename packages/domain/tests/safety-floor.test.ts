import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFETY_FLOOR,
  validateSafetyFloor,
  assertSafetyFloor,
  SafetyFloorViolationError,
} from '../src/index.js';

describe('Safety Floor Invariants (ADR 0060)', () => {
  it('defines correct baseline invariants', () => {
    assert.equal(SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS, 15);
    assert.equal(SAFETY_FLOOR.MAX_DAILY_LIMIT_CEILING, 1000);
    assert.equal(SAFETY_FLOOR.MAX_BURST_ALLOWANCE, 1);
    assert.equal(SAFETY_FLOOR.REQUIRE_RESPONSIBILITY_CONFIRMATION, true);
  });

  it('validates a compliant campaign configuration successfully', () => {
    const validConfig = {
      pacingIntervalSeconds: 30,
      dailyLimit: 250,
      confirmedResponsibility: true,
    };

    const res = validateSafetyFloor(validConfig);
    assert.equal(res.isValid, true);
    assert.equal(res.violations.length, 0);

    assert.doesNotThrow(() => assertSafetyFloor(validConfig));
  });

  it('rejects pacing intervals below the safety floor (< 15 seconds)', () => {
    const burstConfigs = [
      { pacingIntervalSeconds: 0, dailyLimit: 100, confirmedResponsibility: true },
      { pacingIntervalSeconds: 5, dailyLimit: 100, confirmedResponsibility: true },
      { pacingIntervalSeconds: 14, dailyLimit: 100, confirmedResponsibility: true },
    ];

    for (const config of burstConfigs) {
      const res = validateSafetyFloor(config);
      assert.equal(res.isValid, false);
      assert.ok(res.violations.some((v) => v.includes('Pacing interval')));

      assert.throws(
        () => assertSafetyFloor(config),
        (err) => err instanceof SafetyFloorViolationError && err.code === 'SAFETY_FLOOR_VIOLATION'
      );
    }
  });

  it('allows minimum boundary pacing interval of exactly 15 seconds', () => {
    const boundaryConfig = {
      pacingIntervalSeconds: 15,
      dailyLimit: 500,
      confirmedResponsibility: true,
    };

    assert.doesNotThrow(() => assertSafetyFloor(boundaryConfig));
  });

  it('rejects daily limits exceeding the safety ceiling (> 1000 messages)', () => {
    const excessConfigs = [
      { pacingIntervalSeconds: 20, dailyLimit: 1001, confirmedResponsibility: true },
      { pacingIntervalSeconds: 20, dailyLimit: 5000, confirmedResponsibility: true },
    ];

    for (const config of excessConfigs) {
      const res = validateSafetyFloor(config);
      assert.equal(res.isValid, false);
      assert.ok(res.violations.some((v) => v.includes('Safety Floor ceiling')));

      assert.throws(() => assertSafetyFloor(config), SafetyFloorViolationError);
    }
  });

  it('rejects non-positive daily limits (<= 0)', () => {
    const invalidConfigs = [
      { pacingIntervalSeconds: 20, dailyLimit: 0, confirmedResponsibility: true },
      { pacingIntervalSeconds: 20, dailyLimit: -50, confirmedResponsibility: true },
    ];

    for (const config of invalidConfigs) {
      const res = validateSafetyFloor(config);
      assert.equal(res.isValid, false);
      assert.throws(() => assertSafetyFloor(config), SafetyFloorViolationError);
    }
  });

  it('requires explicit confirmation of operational responsibility', () => {
    const unconfirmedConfig = {
      pacingIntervalSeconds: 30,
      dailyLimit: 100,
      confirmedResponsibility: false,
    };

    const res = validateSafetyFloor(unconfirmedConfig);
    assert.equal(res.isValid, false);
    assert.ok(res.violations.some((v) => v.includes('responsibility')));

    assert.throws(() => assertSafetyFloor(unconfirmedConfig), SafetyFloorViolationError);
  });
});
