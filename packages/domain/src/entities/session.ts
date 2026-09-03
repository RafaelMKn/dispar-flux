import { InvariantViolationError } from '../errors/domain-errors.js';

export const SESSION_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours of inactivity
export const SESSION_ABSOLUTE_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days maximum lifespan

export interface Session {
  id: string;
  memberId: string;
  deviceId: string;
  tokenHash: string;
  lastActivityAt: Date;
  idleExpiresAt: Date;
  expiresAt: Date; // Absolute expiration
  revokedAt?: Date;
  createdAt: Date;
}

export interface CreateSessionParams {
  id: string;
  memberId: string;
  deviceId: string;
  tokenHash: string;
  createdAt?: Date;
}

export function createSession(params: CreateSessionParams): Session {
  const tokenHash = params.tokenHash.trim();
  if (!tokenHash) {
    throw new InvariantViolationError('Token hash cannot be empty');
  }

  const now = params.createdAt ?? new Date();
  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS);

  return {
    id: params.id,
    memberId: params.memberId,
    deviceId: params.deviceId,
    tokenHash,
    lastActivityAt: now,
    idleExpiresAt,
    expiresAt,
    createdAt: now,
  };
}

export function isSessionValid(session: Session, now: Date = new Date()): boolean {
  if (session.revokedAt !== undefined && session.revokedAt <= now) return false;
  if (session.idleExpiresAt <= now) return false;
  if (session.expiresAt <= now) return false;
  return true;
}

export function touchSession(session: Session, now: Date = new Date()): Session {
  if (!isSessionValid(session, now)) {
    throw new InvariantViolationError('Cannot touch an expired or revoked session');
  }

  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
  return {
    ...session,
    lastActivityAt: now,
    // Idle expiration slides, but absolute expiration never extends past original limit
    idleExpiresAt: idleExpiresAt > session.expiresAt ? session.expiresAt : idleExpiresAt,
  };
}

export function revokeSession(session: Session, now: Date = new Date()): Session {
  return {
    ...session,
    revokedAt: now,
  };
}
