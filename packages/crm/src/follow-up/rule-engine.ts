import crypto from 'node:crypto';
import { InvariantViolationError } from '@dispar-flux/domain';
import {
  type FollowUpRule,
  type CreateFollowUpRuleInput,
  type AutomationJob,
  type FollowUpCandidate,
  type SimpleConversation,
  type SimpleMessage,
} from './types.js';
import type { CrmLead } from '../lead/types.js';

export interface EvaluateNonResponsiveParams {
  organizationId: string;
  funnelId?: string;
  leads: CrmLead[];
  conversations: SimpleConversation[];
  messages: SimpleMessage[];
  optOutCheckFn?: (contactId: string) => boolean | Promise<boolean>;
  existingJobs?: AutomationJob[];
  now?: Date;
}

export class FollowUpRuleEngine {
  private readonly rules = new Map<string, FollowUpRule>();

  /**
   * Registers a new follow-up rule for a funnel stage.
   */
  createRule(input: CreateFollowUpRuleInput): FollowUpRule {
    const name = input.name?.trim();
    if (!name) throw new InvariantViolationError('Follow-up rule name cannot be empty');
    if (!input.organizationId) throw new InvariantViolationError('Organization ID is required');
    if (!input.funnelId) throw new InvariantViolationError('Funnel ID is required');
    if (!input.stageId) throw new InvariantViolationError('Stage ID is required');
    if (!input.messageTemplate?.trim()) throw new InvariantViolationError('Message template cannot be empty');

    if (input.delayIntervalSeconds <= 0) {
      throw new InvariantViolationError('Delay interval seconds must be positive');
    }

    const maxAttempts = input.maxAttempts ?? 1;
    if (maxAttempts < 1) {
      throw new InvariantViolationError('Max attempts must be at least 1');
    }

    const now = new Date();
    const rule: FollowUpRule = {
      id: input.id ?? `frule-${crypto.randomUUID()}`,
      organizationId: input.organizationId,
      funnelId: input.funnelId,
      stageId: input.stageId,
      name,
      delayIntervalSeconds: input.delayIntervalSeconds,
      messageTemplate: input.messageTemplate.trim(),
      isActive: input.isActive ?? true,
      maxAttempts,
      createdAt: now,
      updatedAt: now,
    };

    this.rules.set(rule.id, rule);
    return rule;
  }

  getRule(ruleId: string): FollowUpRule | undefined {
    return this.rules.get(ruleId);
  }

  listRules(organizationId: string, funnelId?: string): FollowUpRule[] {
    const list: FollowUpRule[] = [];
    for (const r of this.rules.values()) {
      if (r.organizationId === organizationId) {
        if (!funnelId || r.funnelId === funnelId) {
          list.push(r);
        }
      }
    }
    return list;
  }

  updateRule(ruleId: string, input: Partial<CreateFollowUpRuleInput>): FollowUpRule {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new InvariantViolationError(`Follow-up rule "${ruleId}" not found`);
    }

    const updated: FollowUpRule = {
      ...rule,
      name: input.name?.trim() || rule.name,
      delayIntervalSeconds: input.delayIntervalSeconds ?? rule.delayIntervalSeconds,
      messageTemplate: input.messageTemplate?.trim() || rule.messageTemplate,
      isActive: input.isActive !== undefined ? input.isActive : rule.isActive,
      maxAttempts: input.maxAttempts ?? rule.maxAttempts,
      updatedAt: new Date(),
    };
    this.rules.set(ruleId, updated);
    return updated;
  }

  /**
   * Evaluates leads against active follow-up rules to detect non-responsive contacts.
   *
   * Invariants (ADR 0027, ADR 0040, ADR 0043):
   * 1. Opt-out in entire organization blocks follow-up generation.
   * 2. Only leads whose last interaction was an outbound message without a subsequent inbound response are candidates.
   * 3. Contact is candidate only after elapsed time exceeds configured interval.
   * 4. Attempts are capped by rule.maxAttempts.
   */
  async evaluateNonResponsiveLeads(
    params: EvaluateNonResponsiveParams
  ): Promise<FollowUpCandidate[]> {
    const now = params.now ?? new Date();
    const candidates: FollowUpCandidate[] = [];

    // Map existing jobs by `${leadId}:${ruleId}`
    const jobCountMap = new Map<string, number>();
    if (params.existingJobs) {
      for (const j of params.existingJobs) {
        if (j.ruleId && (j.status === 'sent' || j.status === 'pending' || j.status === 'sending')) {
          const key = `${j.leadId}:${j.ruleId}`;
          jobCountMap.set(key, (jobCountMap.get(key) ?? 0) + 1);
        }
      }
    }

    // Index conversations by contactId
    const convsByContact = new Map<string, SimpleConversation>();
    for (const conv of params.conversations) {
      convsByContact.set(conv.contactId, conv);
    }

    // Index messages by conversationId
    const messagesByConv = new Map<string, SimpleMessage[]>();
    for (const msg of params.messages) {
      const list = messagesByConv.get(msg.conversationId) ?? [];
      list.push(msg);
      messagesByConv.set(msg.conversationId, list);
    }

    // Retrieve active rules
    const activeRules = this.listRules(params.organizationId, params.funnelId).filter(
      (r) => r.isActive
    );

    for (const rule of activeRules) {
      // Find leads in the target stage
      const matchingLeads = params.leads.filter(
        (l) => l.funnelId === rule.funnelId && l.stageId === rule.stageId
      );

      for (const lead of matchingLeads) {
        // Invariant ADR 0040 & ADR 0043: Opt-out blocks follow-ups
        if (params.optOutCheckFn) {
          const isOptedOut = await params.optOutCheckFn(lead.contactId);
          if (isOptedOut) {
            continue;
          }
        }

        // Check if max attempts reached for this rule & lead
        const existingCount = jobCountMap.get(`${lead.id}:${rule.id}`) ?? 0;
        if (existingCount >= rule.maxAttempts) {
          continue;
        }

        const conv = convsByContact.get(lead.contactId);
        if (!conv) {
          continue;
        }

        const convMessages = messagesByConv.get(conv.id) ?? [];
        if (convMessages.length === 0) {
          continue;
        }

        // Sort messages by createdAt/sentAt ascending
        const sorted = [...convMessages].sort((a, b) => {
          const timeA = (a.sentAt ?? a.createdAt).getTime();
          const timeB = (b.sentAt ?? b.createdAt).getTime();
          return timeA - timeB;
        });

        // Find last outbound message
        let lastOutbound: SimpleMessage | undefined;
        let lastOutboundIndex = -1;
        for (let i = sorted.length - 1; i >= 0; i--) {
          const msg = sorted[i];
          if (msg && msg.direction === 'outbound') {
            lastOutbound = msg;
            lastOutboundIndex = i;
            break;
          }
        }

        if (!lastOutbound) {
          // No outbound message was ever sent, contact is not waiting on follow-up
          continue;
        }

        // Check if there is an inbound message AFTER the last outbound
        const hasSubsequentInbound = sorted
          .slice(lastOutboundIndex + 1)
          .some((m) => m.direction === 'inbound');

        if (hasSubsequentInbound) {
          // Contact responded! Not non-responsive
          continue;
        }

        const lastOutboundAt = lastOutbound.sentAt ?? lastOutbound.createdAt;
        const elapsedSeconds = (now.getTime() - lastOutboundAt.getTime()) / 1000;

        if (elapsedSeconds >= rule.delayIntervalSeconds) {
          candidates.push({
            lead,
            rule,
            contactId: lead.contactId,
            lastOutboundAt,
            elapsedSeconds,
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Generates pending AutomationJob instances from qualified candidates.
   */
  generateFollowUpJobs(
    candidates: FollowUpCandidate[],
    connectionId: string,
    contactAttributes?: Map<string, { name?: string; customFields?: Record<string, string> }>,
    now = new Date()
  ): AutomationJob[] {
    const jobs: AutomationJob[] = [];

    for (const candidate of candidates) {
      const contactData = contactAttributes?.get(candidate.contactId);
      const rendered = this.renderTemplate(candidate.rule.messageTemplate, {
        name: contactData?.name ?? 'Cliente',
        contact: {
          name: contactData?.name ?? 'Cliente',
          ...contactData?.customFields,
        },
        lead: {
          value: candidate.lead.value !== undefined ? String(candidate.lead.value) : '',
        },
      });

      const job: AutomationJob = {
        id: `fjob-${crypto.randomUUID()}`,
        organizationId: candidate.rule.organizationId,
        connectionId,
        contactId: candidate.contactId,
        leadId: candidate.lead.id,
        funnelId: candidate.rule.funnelId,
        stageId: candidate.rule.stageId,
        ruleId: candidate.rule.id,
        type: 'follow_up',
        renderedMessage: rendered,
        status: 'pending',
        scheduledFor: now,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      jobs.push(job);
    }

    return jobs;
  }

  private renderTemplate(template: string, vars: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const parts = key.split('.');
      let val: unknown = vars;
      for (const p of parts) {
        if (val && typeof val === 'object' && p in val) {
          val = (val as Record<string, unknown>)[p];
        } else {
          return '';
        }
      }
      return val !== undefined && val !== null ? String(val) : '';
    });
  }
}
