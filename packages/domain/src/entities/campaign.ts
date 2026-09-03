import { InvariantViolationError, SafetyFloorViolationError } from '../errors/domain-errors.js';

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'completed' | 'canceled';
export type JobStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'unknown';

export interface Campaign {
  id: string;
  organizationId: string;
  connectionId: string;
  baseId?: string;
  name: string;
  status: CampaignStatus;
  messageTemplate: string;
  pacingIntervalSeconds: number;
  dailyLimit: number;
  confirmedResponsibility: boolean;
  snapshotTotal: number;
  sentCount: number;
  failedCount: number;
  unknownCount: number; // ADR 0028: Envios Incertos
  startedAt?: Date;
  completedAt?: Date;
  pausedAt?: Date;
  canceledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCampaignParams {
  id: string;
  organizationId: string;
  connectionId: string;
  baseId?: string;
  name: string;
  messageTemplate: string;
  pacingIntervalSeconds: number;
  dailyLimit: number;
  confirmedResponsibility: boolean;
  snapshotTotal?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createCampaign(params: CreateCampaignParams): Campaign {
  const name = params.name.trim();
  const messageTemplate = params.messageTemplate.trim();

  if (!name) {
    throw new InvariantViolationError('Campaign name cannot be empty');
  }
  if (!messageTemplate) {
    throw new InvariantViolationError('Campaign message template cannot be empty');
  }
  if (!params.connectionId) {
    throw new InvariantViolationError('Campaign must belong to a messaging connection');
  }

  const now = new Date();
  return {
    id: params.id,
    organizationId: params.organizationId,
    connectionId: params.connectionId,
    baseId: params.baseId,
    name,
    status: 'draft',
    messageTemplate,
    pacingIntervalSeconds: params.pacingIntervalSeconds,
    dailyLimit: params.dailyLimit,
    confirmedResponsibility: params.confirmedResponsibility,
    snapshotTotal: params.snapshotTotal ?? 0,
    sentCount: 0,
    failedCount: 0,
    unknownCount: 0,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}

export interface CampaignJob {
  id: string;
  campaignId: string;
  contactId: string;
  normalizedPhone: string;
  renderedMessage: string;
  status: JobStatus;
  scheduledFor?: Date;
  sentAt?: Date;
  errorReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCampaignJobParams {
  id: string;
  campaignId: string;
  contactId: string;
  normalizedPhone: string;
  renderedMessage: string;
  status?: JobStatus;
  scheduledFor?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createCampaignJob(params: CreateCampaignJobParams): CampaignJob {
  if (!params.campaignId) {
    throw new InvariantViolationError('Job must belong to a campaign');
  }
  if (!params.contactId) {
    throw new InvariantViolationError('Job must target a contact');
  }
  if (!params.normalizedPhone) {
    throw new InvariantViolationError('Job requires normalized phone');
  }
  if (!params.renderedMessage) {
    throw new InvariantViolationError('Job requires rendered message');
  }

  const now = new Date();
  return {
    id: params.id,
    campaignId: params.campaignId,
    contactId: params.contactId,
    normalizedPhone: params.normalizedPhone,
    renderedMessage: params.renderedMessage,
    status: params.status ?? 'pending',
    scheduledFor: params.scheduledFor,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}

/**
 * ADR 0028: Envios Incertos ('unknown') NEVER repeat automatically!
 * Only failed jobs with known failure may be eligible for safe manual retry.
 */
export function canRetryJob(status: JobStatus): boolean {
  if (status === 'unknown') return false; // Invariant: unknown sends must never be retried automatically
  if (status === 'sent') return false;
  if (status === 'sending') return false;
  return status === 'failed';
}
