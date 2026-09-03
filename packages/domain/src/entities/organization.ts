import { InvariantViolationError } from '../errors/domain-errors.js';

export interface RetentionPolicy {
  messagesDays: number;
  mediaDays: number;
  logsDays: number;
}

export interface Organization {
  id: string;
  name: string;
  operationalTimezone: string;
  retentionPolicy: RetentionPolicy;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationParams {
  id: string;
  name: string;
  operationalTimezone?: string;
  retentionPolicy?: Partial<RetentionPolicy>;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  messagesDays: 365,
  mediaDays: 90,
  logsDays: 30,
};

export const DEFAULT_OPERATIONAL_TIMEZONE = 'America/Sao_Paulo';

export function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function createOrganization(params: CreateOrganizationParams): Organization {
  const name = params.name.trim();
  if (!name) {
    throw new InvariantViolationError('Organization name cannot be empty');
  }

  const timezone = params.operationalTimezone?.trim() || DEFAULT_OPERATIONAL_TIMEZONE;
  if (!isValidIanaTimezone(timezone)) {
    throw new InvariantViolationError(`Invalid operational timezone: ${timezone}`);
  }

  const retentionPolicy: RetentionPolicy = {
    messagesDays: params.retentionPolicy?.messagesDays ?? DEFAULT_RETENTION_POLICY.messagesDays,
    mediaDays: params.retentionPolicy?.mediaDays ?? DEFAULT_RETENTION_POLICY.mediaDays,
    logsDays: params.retentionPolicy?.logsDays ?? DEFAULT_RETENTION_POLICY.logsDays,
  };

  if (
    retentionPolicy.messagesDays <= 0 ||
    retentionPolicy.mediaDays <= 0 ||
    retentionPolicy.logsDays <= 0
  ) {
    throw new InvariantViolationError('Retention policy periods must be positive numbers');
  }

  const now = new Date();
  return {
    id: params.id,
    name,
    operationalTimezone: timezone,
    retentionPolicy,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}
