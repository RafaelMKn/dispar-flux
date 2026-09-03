import type { CampaignStatus, JobStatus, Campaign, CampaignJob } from '@dispar-flux/domain';

export interface CampaignRow {
  id: string;
  organization_id: string;
  connection_id: string;
  base_id: string | null;
  name: string;
  status: string;
  message_template: string;
  pacing_interval_seconds: number;
  daily_limit: number;
  confirmed_responsibility: number;
  snapshot_total: number;
  sent_count: number;
  failed_count: number;
  unknown_count: number;
  started_at: string | null;
  completed_at: string | null;
  paused_at: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignJobRow {
  id: string;
  campaign_id: string;
  contact_id: string;
  normalized_phone: string;
  rendered_message: string;
  status: string;
  scheduled_for: string | null;
  sent_at: string | null;
  error_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCampaignInput {
  organizationId: string;
  connectionId: string;
  baseId?: string;
  name: string;
  messageTemplate: string;
  pacingIntervalSeconds?: number;
  dailyLimit?: number;
  confirmedResponsibility?: boolean;
}

export interface SendMessageParams {
  connectionId: string;
  to: string; // Normalized E.164 phone
  content: string;
  campaignJobId: string;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface MessagingDispatcher {
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
}

export type SleepFunction = (ms: number) => Promise<void>;

export interface ExecutionEngineOptions {
  sleepFn?: SleepFunction;
  suppressionSalt?: string;
}

export function mapRowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectionId: row.connection_id,
    baseId: row.base_id ?? undefined,
    name: row.name,
    status: row.status as CampaignStatus,
    messageTemplate: row.message_template,
    pacingIntervalSeconds: row.pacing_interval_seconds,
    dailyLimit: row.daily_limit,
    confirmedResponsibility: row.confirmed_responsibility === 1,
    snapshotTotal: row.snapshot_total,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    unknownCount: row.unknown_count,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    pausedAt: row.paused_at ? new Date(row.paused_at) : undefined,
    canceledAt: row.canceled_at ? new Date(row.canceled_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function mapRowToJob(row: CampaignJobRow): CampaignJob {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    normalizedPhone: row.normalized_phone,
    renderedMessage: row.rendered_message,
    status: row.status as JobStatus,
    scheduledFor: row.scheduled_for ? new Date(row.scheduled_for) : undefined,
    sentAt: row.sent_at ? new Date(row.sent_at) : undefined,
    errorReason: row.error_reason ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
