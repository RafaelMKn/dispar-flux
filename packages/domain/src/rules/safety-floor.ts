import { SafetyFloorViolationError } from '../errors/domain-errors.js';

/**
 * ADR 0060: Piso de Segurança (Safety Floor)
 *
 * "O Proprietário poderá ajustar pacing e limites somente dentro de um Piso de Segurança
 * que preserve serialização, teto absoluto, opt-out, confirmação de responsabilidade e
 * proteção contra rajadas. Nem a Edição Comunitária nem o Serviço Gerenciado prometerão
 * impedir bloqueios do WhatsApp ou substituir as obrigações jurídicas da Organização."
 */
export const SAFETY_FLOOR = {
  /**
   * Minimum allowable interval in seconds between automated messages.
   * Prevents burst dispatches that trigger carrier and WhatsApp spam mitigations.
   */
  MIN_PACING_INTERVAL_SECONDS: 15,

  /**
   * Default suggested interval in seconds between automated messages.
   */
  DEFAULT_PACING_INTERVAL_SECONDS: 30,

  /**
   * Maximum ceiling of automated messages permitted per connection per 24-hour cycle.
   */
  MAX_DAILY_LIMIT_CEILING: 1000,

  /**
   * Default safe daily limit.
   */
  DEFAULT_DAILY_LIMIT: 200,

  /**
   * Strict serialization: exactly 1 message processed at a time per messaging connection.
   */
  MAX_BURST_ALLOWANCE: 1,

  /**
   * Requirement that campaign execution must have explicit responsible confirmation by an Owner.
   */
  REQUIRE_RESPONSIBILITY_CONFIRMATION: true,
} as const;

export interface SafetyFloorConfig {
  pacingIntervalSeconds: number;
  dailyLimit: number;
  confirmedResponsibility?: boolean;
}

export interface SafetyFloorValidationResult {
  isValid: boolean;
  violations: string[];
}

/**
 * Validates whether campaign configuration complies with the mandatory Safety Floor invariants.
 */
export function validateSafetyFloor(config: SafetyFloorConfig): SafetyFloorValidationResult {
  const violations: string[] = [];

  if (
    typeof config.pacingIntervalSeconds !== 'number' ||
    isNaN(config.pacingIntervalSeconds) ||
    config.pacingIntervalSeconds < SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS
  ) {
    violations.push(
      `Pacing interval (${config.pacingIntervalSeconds}s) violates Safety Floor: minimum is ${SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS} seconds.`
    );
  }

  if (
    typeof config.dailyLimit !== 'number' ||
    isNaN(config.dailyLimit) ||
    config.dailyLimit <= 0
  ) {
    violations.push('Daily limit must be a positive integer.');
  } else if (config.dailyLimit > SAFETY_FLOOR.MAX_DAILY_LIMIT_CEILING) {
    violations.push(
      `Daily limit (${config.dailyLimit}) violates Safety Floor ceiling: maximum is ${SAFETY_FLOOR.MAX_DAILY_LIMIT_CEILING} messages/day.`
    );
  }

  if (SAFETY_FLOOR.REQUIRE_RESPONSIBILITY_CONFIRMATION && !config.confirmedResponsibility) {
    violations.push(
      'Automated dispatch requires explicit confirmation of operational responsibility (confirmedResponsibility: true).'
    );
  }

  return {
    isValid: violations.length === 0,
    violations,
  };
}

/**
 * Asserts that the configuration respects Safety Floor invariants, throwing typed SafetyFloorViolationError if not.
 */
export function assertSafetyFloor(config: SafetyFloorConfig): void {
  const result = validateSafetyFloor(config);
  if (!result.isValid) {
    throw new SafetyFloorViolationError(
      `Safety floor violation:\n- ${result.violations.join('\n- ')}`,
      'SAFETY_FLOOR_VIOLATION'
    );
  }
}
