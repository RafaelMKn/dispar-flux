import { OptOutViolationError } from '../errors/domain-errors.js';
import { OptOut, SuppressionKey, generateSuppressionHash } from '../entities/opt-out.js';

export interface SendEligibilityResult {
  eligible: boolean;
  reason?: 'opted_out' | 'suppressed';
  details?: string;
}

/**
 * Checks whether an automated message can be sent to a normalized phone number.
 * Enforces ADR 0040 (Organization-wide Opt-out) and ADR 0044 (Pseudonymous Suppression Key).
 */
export function canSendAutomatedMessage(params: {
  normalizedPhone: string;
  optOuts: OptOut[];
  suppressionKeys?: SuppressionKey[];
  suppressionSalt?: string;
}): SendEligibilityResult {
  const phone = params.normalizedPhone.trim();

  // 1. Check active Opt-Outs across the organization (ADR 0040)
  const activeOptOut = params.optOuts.find(
    (opt) => opt.normalizedPhone === phone && !opt.reauthorizedAt
  );

  if (activeOptOut) {
    return {
      eligible: false,
      reason: 'opted_out',
      details: `Phone ${phone} registered an organization-wide opt-out on ${activeOptOut.createdAt.toISOString()}`,
    };
  }

  // 2. Check Pseudonymous Suppression Keys (ADR 0044)
  if (params.suppressionKeys && params.suppressionSalt) {
    const hash = generateSuppressionHash(phone, params.suppressionSalt);
    const isSuppressed = params.suppressionKeys.some((sk) => sk.hashKey === hash);

    if (isSuppressed) {
      return {
        eligible: false,
        reason: 'suppressed',
        details: `Phone matches a pseudonymous suppression key derived from a previously deleted contact`,
      };
    }
  }

  return { eligible: true };
}

/**
 * Asserts that an automated message can be sent, throwing OptOutViolationError if prohibited.
 */
export function assertCanSendAutomatedMessage(params: {
  normalizedPhone: string;
  optOuts: OptOut[];
  suppressionKeys?: SuppressionKey[];
  suppressionSalt?: string;
}): void {
  const result = canSendAutomatedMessage(params);
  if (!result.eligible) {
    throw new OptOutViolationError(
      result.details ?? 'Automated dispatch blocked by opt-out or suppression policy',
      params.normalizedPhone
    );
  }
}
