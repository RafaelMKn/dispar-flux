import type { CampaignStatus, JobStatus } from '@dispar-flux/domain';

export interface CreateCampaignRequest {
  name: string;
  connectionId: string;
  baseId?: string;
  messageTemplate: string;
  pacingIntervalSeconds: number;
  dailyLimit: number;
  confirmedResponsibility: boolean;
}

export interface CampaignResponse {
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
  unknownCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
}

export interface CampaignJobResponse {
  id: string;
  campaignId: string;
  contactId: string;
  normalizedPhone: string;
  renderedMessage: string;
  status: JobStatus;
  errorReason?: string;
  sentAt?: string;
  createdAt: string;
}

export interface ListCampaignsResponse {
  campaigns: CampaignResponse[];
  total: number;
}
