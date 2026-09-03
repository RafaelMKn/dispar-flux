import type { FunnelStage } from '@dispar-flux/domain';

export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled' | 'no_show';
export type AutomationJobStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'canceled';

export interface FunnelStageDto {
  id: string;
  name: string;
  order: number;
}

export interface CreateFunnelRequest {
  name: string;
  stages?: FunnelStageDto[];
  isActive?: boolean;
}

export interface FunnelResponse {
  id: string;
  organizationId: string;
  name: string;
  stages: FunnelStageDto[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeadRequest {
  funnelId: string;
  contactId: string;
  stageId?: string;
  value?: number;
  notes?: string;
}

export interface UpdateLeadRequest {
  value?: number;
  notes?: string;
}

export interface MoveLeadRequest {
  stageId: string;
  reason?: string;
}

export interface LeadResponse {
  id: string;
  organizationId: string;
  funnelId: string;
  contactId: string;
  stageId: string;
  value?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppointmentRequest {
  contactId: string;
  leadId?: string;
  title: string;
  description?: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  reminderMinutesBefore?: number[];
  timezone?: string;
}

export interface AppointmentResponse {
  id: string;
  organizationId: string;
  contactId: string;
  leadId?: string;
  title: string;
  description?: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  status: AppointmentStatus;
  reminderMinutesBefore: number[];
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFollowUpRuleRequest {
  funnelId: string;
  stageId: string;
  name: string;
  delayIntervalSeconds: number;
  messageTemplate: string;
  isActive?: boolean;
  maxAttempts?: number;
}

export interface FollowUpRuleResponse {
  id: string;
  organizationId: string;
  funnelId: string;
  stageId: string;
  name: string;
  delayIntervalSeconds: number;
  messageTemplate: string;
  isActive: boolean;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationJobResponse {
  id: string;
  organizationId: string;
  connectionId: string;
  contactId: string;
  leadId: string;
  funnelId: string;
  stageId: string;
  ruleId?: string;
  type: 'follow_up' | 'campaign';
  renderedMessage: string;
  status: AutomationJobStatus;
  scheduledFor: string;
  sentAt?: string;
  errorReason?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}
