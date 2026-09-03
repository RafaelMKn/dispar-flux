import type { AuditRecord } from '@dispar-flux/domain';

export interface InboundMessagePayload {
  id: string;
  organizationId: string;
  conversationId: string;
  contactId: string;
  content?: string;
  createdAt: Date;
}

export interface OutboundMessageReference {
  id: string;
  conversationId: string;
  sentAt?: Date;
  createdAt: Date;
  campaignJobId?: string;
  followUpJobId?: string;
  funnelId?: string;
  leadId?: string;
}

export interface ContactExistenceChecker {
  contactExistsInBaseOrCrm(contactId: string): boolean | Promise<boolean>;
}

export type AttributionOutcome = 'advanced' | 'ignored' | 'ambiguous';

export interface AttributionResult {
  outcome: AttributionOutcome;
  reason?: string;
  leadId?: string;
  funnelId?: string;
  fromStageId?: string;
  toStageId?: string;
  deltaMs?: number;
  leadIds?: string[];
  operatorAlert?: string;
  auditRecord?: AuditRecord;
}
