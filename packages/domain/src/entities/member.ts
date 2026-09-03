import { InvariantViolationError } from '../errors/domain-errors.js';

export type MemberRole = 'owner' | 'operator';

export const MEMBER_ROLES = {
  OWNER: 'owner' as const,
  OPERATOR: 'operator' as const,
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Proprietário',
  operator: 'Operador',
};

export interface Member {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: MemberRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemberParams {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: MemberRole;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createMember(params: CreateMemberParams): Member {
  const name = params.name.trim();
  const email = params.email.trim().toLowerCase();

  if (!name) {
    throw new InvariantViolationError('Member name cannot be empty');
  }
  if (!email || !email.includes('@')) {
    throw new InvariantViolationError(`Invalid member email: ${params.email}`);
  }
  if (params.role !== 'owner' && params.role !== 'operator') {
    throw new InvariantViolationError(`Invalid member role: ${params.role}`);
  }

  const now = new Date();
  return {
    id: params.id,
    organizationId: params.organizationId,
    name,
    email,
    role: params.role,
    isActive: params.isActive ?? true,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}

export function isOwner(member: Member): boolean {
  return member.role === 'owner' && member.isActive;
}

export function isOperator(member: Member): boolean {
  return member.role === 'operator' && member.isActive;
}

/**
 * Ensures the invariant that the organization always has at least one active Owner.
 */
export function ensureAtLeastOneOwner(members: Member[]): boolean {
  const hasActiveOwner = members.some((m) => m.role === 'owner' && m.isActive);
  if (!hasActiveOwner) {
    throw new InvariantViolationError('Organization must preserve at least one active Owner (Proprietário)');
  }
  return true;
}
