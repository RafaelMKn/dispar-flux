import { FunnelManager } from '../funnel/funnel-manager.js';
import { LeadManager } from '../lead/lead-manager.js';
import { getInitialStage, getInProgressStage } from '../funnel/types.js';
import {
  type InboundMessagePayload,
  type OutboundMessageReference,
  type ContactExistenceChecker,
  type AttributionResult,
} from './types.js';

export const AUTO_REPLY_THRESHOLD_MS = 1000; // <= 1000ms classifies as WhatsApp Business auto-reply

export class ResponseAttributor {
  constructor(
    private readonly funnelManager: FunnelManager,
    private readonly leadManager: LeadManager,
    private readonly contactChecker?: ContactExistenceChecker
  ) {}

  /**
   * Processes an incoming message from a contact and evaluates response attribution & stage progression.
   *
   * Invariants (ADR 0042 & Phase 6 specs):
   * 1. Only leads whose contact exists in an imported base or CRM are processed.
   * 2. WhatsApp Business auto-replies arriving <= 1000ms after an outbound message do NOT move the lead's stage.
   * 3. First valid customer response automatically moves a lead in initial stage ("novo") to "em andamento".
   * 4. When attribution is ambiguous (multiple active funnels/leads), signals to the operator rather than moving leads silently.
   */
  async processInboundMessage(
    inbound: InboundMessagePayload,
    lastOutbound?: OutboundMessageReference
  ): Promise<AttributionResult> {
    // 1. Contact existence check
    if (this.contactChecker) {
      const exists = await this.contactChecker.contactExistsInBaseOrCrm(inbound.contactId);
      if (!exists) {
        return {
          outcome: 'ignored',
          reason: 'contact_not_in_base_or_crm',
        };
      }
    }

    // 2. WhatsApp Business Auto-reply rejection
    if (lastOutbound) {
      const refTime = lastOutbound.sentAt ?? lastOutbound.createdAt;
      const deltaMs = inbound.createdAt.getTime() - refTime.getTime();

      if (deltaMs >= 0 && deltaMs <= AUTO_REPLY_THRESHOLD_MS) {
        return {
          outcome: 'ignored',
          reason: 'auto_reply_rejected',
          deltaMs,
        };
      }
    }

    // 3. Find leads for this contact
    const allLeadsForContact = this.leadManager.listLeadsByContact(inbound.contactId);
    if (allLeadsForContact.length === 0) {
      return {
        outcome: 'ignored',
        reason: 'no_active_lead',
      };
    }

    // Filter leads belonging to active funnels
    const candidateLeads = allLeadsForContact.filter((lead) => {
      const funnel = this.funnelManager.getFunnel(lead.funnelId);
      return funnel && funnel.isActive;
    });

    if (candidateLeads.length === 0) {
      return {
        outcome: 'ignored',
        reason: 'no_active_lead_in_active_funnel',
      };
    }

    // 4. Ambiguous attribution check (ADR 0042)
    // If the contact participates in multiple active funnels with candidates, signal to operator!
    if (candidateLeads.length > 1) {
      // Check if outbound message explicitly tagged a lead
      const explicitLead = candidateLeads.find((l) => l.id === lastOutbound?.leadId);
      if (!explicitLead) {
        return {
          outcome: 'ambiguous',
          reason: 'multiple_active_leads',
          leadIds: candidateLeads.map((l) => l.id),
          operatorAlert:
            'ADR 0042: Ambiguous response attribution. Contact has active leads in multiple funnels. Case flagged for Operator review.',
        };
      }
    }

    const lead = candidateLeads[0]!;
    const funnel = this.funnelManager.getFunnel(lead.funnelId);
    if (!funnel) {
      return {
        outcome: 'ignored',
        reason: 'funnel_not_found',
      };
    }

    const initialStage = getInitialStage(funnel);
    const inProgressStage = getInProgressStage(funnel);

    // 5. First-response rule: only lead in initial stage ("novo") moves to "em andamento"
    if (lead.stageId !== initialStage.id) {
      return {
        outcome: 'ignored',
        reason: 'lead_not_in_initial_stage',
        leadId: lead.id,
        fromStageId: lead.stageId,
      };
    }

    // Advance stage automatically with system audit attribution
    const moveResult = this.leadManager.moveLead(
      lead.id,
      inProgressStage.id,
      { type: 'system', id: 'system' },
      `Automatic first-response attribution (ADR 0042, message ID: ${inbound.id})`
    );

    return {
      outcome: 'advanced',
      leadId: lead.id,
      funnelId: lead.funnelId,
      fromStageId: initialStage.id,
      toStageId: inProgressStage.id,
      auditRecord: moveResult.auditRecord,
    };
  }
}
