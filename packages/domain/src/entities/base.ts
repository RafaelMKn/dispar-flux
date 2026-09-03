import { InvariantViolationError } from '../errors/domain-errors.js';

export interface Base {
  id: string;
  organizationId: string;
  name: string;
  provenance: string; // Origem declarada (e.g. Planilha Clientes 2026)
  purpose: string; // Finalidade declarada
  acquiredAt: Date; // Data de obtenção da base
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBaseParams {
  id: string;
  organizationId: string;
  name: string;
  provenance: string;
  purpose: string;
  acquiredAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createBase(params: CreateBaseParams): Base {
  const name = params.name.trim();
  const provenance = params.provenance.trim();
  const purpose = params.purpose.trim();

  if (!name) {
    throw new InvariantViolationError('Base name cannot be empty');
  }
  if (!provenance) {
    throw new InvariantViolationError('Base provenance (procedência) cannot be empty');
  }
  if (!purpose) {
    throw new InvariantViolationError('Base purpose (finalidade) cannot be empty');
  }

  const now = new Date();
  return {
    id: params.id,
    organizationId: params.organizationId,
    name,
    provenance,
    purpose,
    acquiredAt: params.acquiredAt ?? now,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}

export interface BaseMembership {
  id: string;
  baseId: string;
  contactId: string;
  importedFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBaseMembershipParams {
  id: string;
  baseId: string;
  contactId: string;
  importedFields?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createBaseMembership(params: CreateBaseMembershipParams): BaseMembership {
  if (!params.baseId) {
    throw new InvariantViolationError('Base ID cannot be empty');
  }
  if (!params.contactId) {
    throw new InvariantViolationError('Contact ID cannot be empty');
  }

  const now = new Date();
  return {
    id: params.id,
    baseId: params.baseId,
    contactId: params.contactId,
    importedFields: params.importedFields ? { ...params.importedFields } : {},
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}
