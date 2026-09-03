import { InvariantViolationError } from '../errors/domain-errors.js';
import { MemberRole } from './member.js';

export const DEFAULT_INVITE_VALIDITY_HOURS = 48;

export interface AccessInvite {
  id: string;
  organizationId: string;
  createdByMemberId: string;
  code: string;
  role: MemberRole;
  expiresAt: Date;
  usedAt?: Date;
  usedByMemberId?: string;
  createdAt: Date;
}

export interface CreateAccessInviteParams {
  id: string;
  organizationId: string;
  createdByMemberId: string;
  code: string;
  role: MemberRole;
  expiresAt?: Date;
  createdAt?: Date;
}

export function createAccessInvite(params: CreateAccessInviteParams): AccessInvite {
  const code = params.code.trim();
  if (!code) {
    throw new InvariantViolationError('Invite code cannot be empty');
  }
  if (params.role !== 'owner' && params.role !== 'operator') {
    throw new InvariantViolationError(`Invalid invite role: ${params.role}`);
  }

  const now = params.createdAt ?? new Date();
  const defaultExpiry = new Date(now.getTime() + DEFAULT_INVITE_VALIDITY_HOURS * 60 * 60 * 1000);
  const expiresAt = params.expiresAt ?? defaultExpiry;

  if (expiresAt <= now) {
    throw new InvariantViolationError('Invite expiration must be in the future');
  }

  return {
    id: params.id,
    organizationId: params.organizationId,
    createdByMemberId: params.createdByMemberId,
    code,
    role: params.role,
    expiresAt,
    createdAt: now,
  };
}

export function isInviteValid(invite: AccessInvite, now: Date = new Date()): boolean {
  if (invite.usedAt !== undefined) return false;
  return invite.expiresAt > now;
}

export function useAccessInvite(invite: AccessInvite, memberId: string, now: Date = new Date()): AccessInvite {
  if (!isInviteValid(invite, now)) {
    throw new InvariantViolationError('Cannot use an expired or already used access invite');
  }

  return {
    ...invite,
    usedAt: now,
    usedByMemberId: memberId,
  };
}
