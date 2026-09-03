import { InvariantViolationError } from '../errors/domain-errors.js';

export type AuditActorType = 'member' | 'service_account' | 'system';

export interface AuditRecord {
  id: string;
  organizationId: string;
  actorType: AuditActorType;
  actorId: string;
  action: string; // e.g. "campaign.start", "opt_out.reauthorize", "auth.login"
  targetType: string; // e.g. "campaign", "contact", "device", "session"
  targetId: string;
  metadata?: Record<string, unknown>; // Sanitized metadata only (no message bodies, no raw passwords)
  timestamp: Date;
}

export interface CreateAuditRecordParams {
  id: string;
  organizationId: string;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

// Prohibited sensitive keys to uphold ADR 0050 (observability without content or PII)
const SENSITIVE_METADATA_KEYS = new Set([
  'password',
  'token',
  'tokenhash',
  'secret',
  'messagecontent',
  'messagebody',
  'rawphone',
  'creditcard',
]);

export function sanitizeAuditMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeAuditMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function createAuditRecord(params: CreateAuditRecordParams): AuditRecord {
  if (!params.organizationId) throw new InvariantViolationError('Organization ID is required');
  if (!params.actorId) throw new InvariantViolationError('Actor ID is required');
  if (!params.action) throw new InvariantViolationError('Action is required');
  if (!params.targetType) throw new InvariantViolationError('Target type is required');
  if (!params.targetId) throw new InvariantViolationError('Target ID is required');

  return {
    id: params.id,
    organizationId: params.organizationId,
    actorType: params.actorType,
    actorId: params.actorId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    metadata: sanitizeAuditMetadata(params.metadata),
    timestamp: params.timestamp ?? new Date(),
  };
}
