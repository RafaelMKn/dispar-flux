import { createHash } from 'node:crypto';
import { InvariantViolationError, ReauthorizationError } from '../errors/domain-errors.js';

export interface OptOut {
  id: string;
  organizationId: string;
  normalizedPhone: string;
  contactId?: string;
  reason?: string;
  createdAt: Date;
  reauthorizedAt?: Date;
  reauthorizedByMemberId?: string;
  reauthorizationReason?: string;
}

export interface CreateOptOutParams {
  id: string;
  organizationId: string;
  normalizedPhone: string;
  contactId?: string;
  reason?: string;
  createdAt?: Date;
}

export function createOptOut(params: CreateOptOutParams): OptOut {
  const normalizedPhone = params.normalizedPhone.trim();
  if (!normalizedPhone) throw new InvariantViolationError('Normalized phone cannot be empty');
  if (!params.organizationId) throw new InvariantViolationError('Organization ID is required');

  return {
    id: params.id,
    organizationId: params.organizationId,
    normalizedPhone,
    contactId: params.contactId,
    reason: params.reason?.trim(),
    createdAt: params.createdAt ?? new Date(),
  };
}

export interface ReauthorizationParams {
  reauthorizedByMemberId: string;
  reauthorizationReason: string;
  reauthorizedAt?: Date;
}

/**
 * ADR 0045: Reauthorization MUST be traceable:
 * Requires actor (reauthorizedByMemberId), justification (reauthorizationReason), and timestamp.
 * Inbound messages or manual operator messages do NOT trigger automatic reauthorization!
 */
export function reauthorizeOptOut(optOut: OptOut, params: ReauthorizationParams): OptOut {
  if (optOut.reauthorizedAt) {
    throw new ReauthorizationError('Opt-out has already been reauthorized');
  }

  const memberId = params.reauthorizedByMemberId?.trim();
  if (!memberId) {
    throw new ReauthorizationError('Reauthorization requires an auditing member actor ID');
  }

  const reason = params.reauthorizationReason?.trim();
  if (!reason || reason.length < 5) {
    throw new ReauthorizationError('Reauthorization requires a meaningful justification (at least 5 characters)');
  }

  const now = params.reauthorizedAt ?? new Date();
  return {
    ...optOut,
    reauthorizedAt: now,
    reauthorizedByMemberId: memberId,
    reauthorizationReason: reason,
  };
}

export interface SuppressionKey {
  id: string;
  organizationId: string;
  hashKey: string;
  createdAt: Date;
}

/**
 * ADR 0044: Generates a pseudonymous suppression hash for a normalized phone number.
 */
export function generateSuppressionHash(normalizedPhone: string, salt: string): string {
  if (!salt) {
    throw new InvariantViolationError('Salt is required for suppression hash generation');
  }
  return createHash('sha256')
    .update(`${salt}:${normalizedPhone.trim()}`)
    .digest('hex');
}

export function createSuppressionKey(params: {
  id: string;
  organizationId: string;
  normalizedPhone: string;
  salt: string;
  createdAt?: Date;
}): SuppressionKey {
  const hashKey = generateSuppressionHash(params.normalizedPhone, params.salt);
  return {
    id: params.id,
    organizationId: params.organizationId,
    hashKey,
    createdAt: params.createdAt ?? new Date(),
  };
}
