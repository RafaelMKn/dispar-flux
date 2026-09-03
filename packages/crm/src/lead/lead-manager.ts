import crypto from 'node:crypto';
import {
  createAuditRecord,
  InvariantViolationError,
  type AuditRecord,
} from '@dispar-flux/domain';
import {
  type CrmLead,
  type CreateLeadInput,
  type UpdateLeadInput,
  type LeadActor,
  type MoveLeadResult,
} from './types.js';
import {
  DuplicateLeadError,
  LeadNotFoundError,
  FunnelNotFoundError,
  InvalidStageError,
} from '../errors.js';
import { FunnelManager } from '../funnel/funnel-manager.js';
import { getInitialStage } from '../funnel/types.js';

export class LeadManager {
  private readonly leads = new Map<string, CrmLead>();
  // ADR 0038: Index by `${contactId}:${funnelId}` to strictly guarantee 1 Lead per (Contact, Funnel)
  private readonly contactFunnelIndex = new Map<string, string>(); // `${contactId}:${funnelId}` -> leadId
  private readonly auditRecords: AuditRecord[] = [];

  constructor(private readonly funnelManager: FunnelManager) {}

  /**
   * Creates a new Lead in a Funnel.
   * Enforces ADR 0038: strictly 1 Lead per (Contact, Funnel).
   */
  createLead(input: CreateLeadInput): CrmLead {
    if (!input.organizationId) {
      throw new InvariantViolationError('Organization ID is required');
    }
    if (!input.funnelId) {
      throw new InvariantViolationError('Funnel ID is required');
    }
    if (!input.contactId) {
      throw new InvariantViolationError('Contact ID is required');
    }

    const funnel = this.funnelManager.getFunnel(input.funnelId);
    if (!funnel) {
      throw new FunnelNotFoundError(input.funnelId);
    }

    // Invariant ADR 0038: Check composite key (contactId, funnelId)
    const compositeKey = this.getCompositeKey(input.contactId, input.funnelId);
    if (this.contactFunnelIndex.has(compositeKey)) {
      throw new DuplicateLeadError(input.contactId, input.funnelId);
    }

    // Resolve stage: provided or default to initial stage (order 0)
    let stageId = input.stageId;
    if (!stageId) {
      const initialStage = getInitialStage(funnel);
      stageId = initialStage.id;
    } else {
      const stageExists = funnel.stages.some((s) => s.id === stageId);
      if (!stageExists) {
        throw new InvalidStageError(`Stage "${stageId}" does not exist in Funnel "${input.funnelId}"`);
      }
    }

    if (input.value !== undefined && input.value < 0) {
      throw new InvariantViolationError('Lead commercial value cannot be negative');
    }

    const now = new Date();
    const lead: CrmLead = {
      id: input.id ?? `lead-${crypto.randomUUID()}`,
      organizationId: input.organizationId,
      funnelId: input.funnelId,
      contactId: input.contactId,
      stageId,
      value: input.value,
      notes: input.notes?.trim(),
      createdAt: now,
      updatedAt: now,
    };

    this.leads.set(lead.id, lead);
    this.contactFunnelIndex.set(compositeKey, lead.id);

    return lead;
  }

  /**
   * Retrieves a Lead by ID.
   */
  getLead(leadId: string): CrmLead | undefined {
    return this.leads.get(leadId);
  }

  /**
   * Retrieves a Lead by Contact and Funnel (ADR 0038 unique pair).
   */
  getLeadByContactAndFunnel(contactId: string, funnelId: string): CrmLead | undefined {
    const key = this.getCompositeKey(contactId, funnelId);
    const leadId = this.contactFunnelIndex.get(key);
    if (!leadId) return undefined;
    return this.leads.get(leadId);
  }

  /**
   * Lists all Leads for a specific Funnel, optionally filtered by Stage.
   */
  listLeadsByFunnel(funnelId: string, stageId?: string): CrmLead[] {
    const list: CrmLead[] = [];
    for (const lead of this.leads.values()) {
      if (lead.funnelId === funnelId) {
        if (!stageId || lead.stageId === stageId) {
          list.push(lead);
        }
      }
    }
    return list;
  }

  /**
   * Lists all Leads for a specific Contact (e.g. across multiple funnels when enabled).
   */
  listLeadsByContact(contactId: string): CrmLead[] {
    const list: CrmLead[] = [];
    for (const lead of this.leads.values()) {
      if (lead.contactId === contactId) {
        list.push(lead);
      }
    }
    return list;
  }

  /**
   * Updates commercial value or deal notes on a Lead.
   */
  updateLead(leadId: string, input: UpdateLeadInput): CrmLead {
    const lead = this.leads.get(leadId);
    if (!lead) {
      throw new LeadNotFoundError(leadId);
    }

    if (input.value !== undefined && input.value < 0) {
      throw new InvariantViolationError('Lead commercial value cannot be negative');
    }

    const updated: CrmLead = {
      ...lead,
      value: input.value !== undefined ? input.value : lead.value,
      notes: input.notes !== undefined ? input.notes.trim() : lead.notes,
      updatedAt: new Date(),
    };

    this.leads.set(leadId, updated);
    return updated;
  }

  /**
   * Moves a Lead to a new stage with audit tracking (ADR 0030 & ADR 0050).
   */
  moveLead(
    leadId: string,
    newStageId: string,
    actor: LeadActor,
    reason?: string
  ): MoveLeadResult {
    const lead = this.leads.get(leadId);
    if (!lead) {
      throw new LeadNotFoundError(leadId);
    }

    const funnel = this.funnelManager.getFunnel(lead.funnelId);
    if (!funnel) {
      throw new FunnelNotFoundError(lead.funnelId);
    }

    const stageExists = funnel.stages.some((s) => s.id === newStageId);
    if (!stageExists) {
      throw new InvalidStageError(`Target stage "${newStageId}" does not exist in Funnel "${lead.funnelId}"`);
    }

    const previousStageId = lead.stageId;
    const now = new Date();

    const updatedLead: CrmLead = {
      ...lead,
      stageId: newStageId,
      updatedAt: now,
    };
    this.leads.set(leadId, updatedLead);

    // Audit record generation
    const auditRecord = createAuditRecord({
      id: `aud-${crypto.randomUUID()}`,
      organizationId: lead.organizationId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'crm.lead.move',
      targetType: 'lead',
      targetId: lead.id,
      metadata: {
        funnelId: lead.funnelId,
        fromStageId: previousStageId,
        toStageId: newStageId,
        contactId: lead.contactId,
        reason: reason ?? 'Stage updated',
      },
      timestamp: now,
    });

    this.auditRecords.push(auditRecord);

    return {
      lead: updatedLead,
      auditRecord,
      previousStageId,
      newStageId,
    };
  }

  /**
   * Retrieves all recorded audit records.
   */
  getAuditRecords(): AuditRecord[] {
    return [...this.auditRecords];
  }

  private getCompositeKey(contactId: string, funnelId: string): string {
    return `${contactId}:${funnelId}`;
  }
}
