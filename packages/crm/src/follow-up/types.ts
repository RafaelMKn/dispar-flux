import type { CrmLead } from '../lead/types.js';

export interface FollowUpRule {
  id: string;
  organizationId: string;
  funnelId: string;
  stageId: string;
  name: string;
  delayIntervalSeconds: number; // e.g. 86400 (24h)
  messageTemplate: string;
  isActive: boolean;
  maxAttempts: number; // default 1
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFollowUpRuleInput {
  id?: string;
  organizationId: string;
  funnelId: string;
  stageId: string;
  name: string;
  delayIntervalSeconds: number;
  messageTemplate: string;
  isActive?: boolean;
  maxAttempts?: number;
}

export type AutomationJobType = 'follow_up' | 'campaign';
export type AutomationJobStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'canceled';

export interface AutomationJob {
  id: string;
  organizationId: string;
  connectionId: string;
  contactId: string;
  leadId: string;
  funnelId: string;
  stageId: string;
  ruleId?: string;
  campaignJobId?: string;
  type: AutomationJobType;
  renderedMessage: string;
  status: AutomationJobStatus;
  scheduledFor: Date;
  sentAt?: Date;
  errorReason?: string;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowUpCandidate {
  lead: CrmLead;
  rule: FollowUpRule;
  contactId: string;
  lastOutboundAt: Date;
  elapsedSeconds: number;
}

export interface SimpleMessage {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  sentAt?: Date;
  createdAt: Date;
}

export interface SimpleConversation {
  id: string;
  organizationId: string;
  connectionId: string;
  contactId: string;
}
