import { InvariantViolationError } from '../errors/domain-errors.js';

export interface FunnelStage {
  id: string;
  name: string;
  order: number;
}

export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled' | 'no_show';
export type AutomationJobStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface Funnel {
  id: string;
  organizationId: string;
  name: string;
  stages: FunnelStage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFunnelParams {
  id: string;
  organizationId: string;
  name: string;
  stages: FunnelStage[];
  createdAt?: Date;
  updatedAt?: Date;
}

export function createFunnel(params: CreateFunnelParams): Funnel {
  const name = params.name.trim();
  if (!name) throw new InvariantViolationError('Funnel name cannot be empty');
  if (!params.stages || params.stages.length === 0) {
    throw new InvariantViolationError('Funnel must have at least one stage');
  }

  // Sort stages by order
  const sortedStages = [...params.stages].sort((a, b) => a.order - b.order);

  const now = new Date();
  return {
    id: params.id,
    organizationId: params.organizationId,
    name,
    stages: sortedStages,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}

export interface Lead {
  id: string;
  organizationId: string;
  funnelId: string;
  contactId: string;
  stageId: string;
  value?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLeadParams {
  id: string;
  organizationId: string;
  funnelId: string;
  contactId: string;
  stageId: string;
  value?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createLead(params: CreateLeadParams): Lead {
  if (!params.organizationId) throw new InvariantViolationError('Organization ID is required');
  if (!params.funnelId) throw new InvariantViolationError('Funnel ID is required');
  if (!params.contactId) throw new InvariantViolationError('Contact ID is required');
  if (!params.stageId) throw new InvariantViolationError('Stage ID is required');

  if (params.value !== undefined && params.value < 0) {
    throw new InvariantViolationError('Lead value cannot be negative');
  }

  const now = new Date();
  return {
    id: params.id,
    organizationId: params.organizationId,
    funnelId: params.funnelId,
    contactId: params.contactId,
    stageId: params.stageId,
    value: params.value,
    notes: params.notes?.trim(),
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}

export function moveLead(lead: Lead, newStageId: string, now: Date = new Date()): Lead {
  if (!newStageId.trim()) throw new InvariantViolationError('Target stage ID cannot be empty');
  return {
    ...lead,
    stageId: newStageId,
    updatedAt: now,
  };
}
