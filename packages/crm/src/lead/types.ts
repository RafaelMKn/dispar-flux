import type { AuditRecord } from '@dispar-flux/domain';

export interface CrmLead {
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

export interface CreateLeadInput {
  id?: string;
  organizationId: string;
  funnelId: string;
  contactId: string;
  stageId?: string;
  value?: number;
  notes?: string;
}

export interface UpdateLeadInput {
  value?: number;
  notes?: string;
}

export interface LeadActor {
  type: 'member' | 'service_account' | 'system';
  id: string;
}

export interface MoveLeadResult {
  lead: CrmLead;
  auditRecord: AuditRecord;
  previousStageId: string;
  newStageId: string;
}
