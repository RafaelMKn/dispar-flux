import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FunnelManager,
  LeadManager,
  ResponseAttributor,
  type ContactExistenceChecker,
} from '../src/index.js';

describe('CRM: Response Attribution & Stage Progression (ADR 0042)', () => {
  const orgId = 'org-crm-attr';

  function setup() {
    const funnelManager = new FunnelManager({ edition: 'community' });
    const funnel = funnelManager.createFunnel({
      organizationId: orgId,
      name: 'Funil Principal',
    });
    const leadManager = new LeadManager(funnelManager);

    // Mock contact checker: default returns true for 'cnt-valid' and false for 'cnt-unknown'
    const contactChecker: ContactExistenceChecker = {
      contactExistsInBaseOrCrm: (contactId: string) => contactId.startsWith('cnt-valid'),
    };

    const attributor = new ResponseAttributor(funnelManager, leadManager, contactChecker);

    return { funnelManager, leadManager, contactChecker, attributor, funnel };
  }

  it('rejects WhatsApp Business Auto-replies arriving <= 1000ms after outbound and does NOT advance stage', async () => {
    const { leadManager, attributor, funnel } = setup();

    const contactId = 'cnt-valid-1';
    const lead = leadManager.createLead({
      organizationId: orgId,
      funnelId: funnel.id,
      contactId,
      stageId: 'stage-novo',
    });

    const now = new Date('2026-09-03T15:00:00.000Z');
    const outboundSentAt = new Date('2026-09-03T15:00:00.000Z');

    // Case 1: Inbound arrives 350ms after outbound (instant automated greeting/away reply)
    const autoReply1 = new Date(outboundSentAt.getTime() + 350);
    const result1 = await attributor.processInboundMessage(
      {
        id: 'msg-in-1',
        organizationId: orgId,
        conversationId: 'conv-1',
        contactId,
        content: 'Olá! Agradecemos sua mensagem. No momento estamos ausentes...',
        createdAt: autoReply1,
      },
      {
        id: 'msg-out-1',
        conversationId: 'conv-1',
        createdAt: outboundSentAt,
        sentAt: outboundSentAt,
      }
    );

    assert.equal(result1.outcome, 'ignored');
    assert.equal(result1.reason, 'auto_reply_rejected');
    assert.equal(result1.deltaMs, 350);

    // Lead stage must remain in 'stage-novo'
    const currentLead1 = leadManager.getLead(lead.id);
    assert.equal(currentLead1?.stageId, 'stage-novo');

    // Case 2: Inbound arrives at exactly 1000ms boundary
    const autoReply2 = new Date(outboundSentAt.getTime() + 1000);
    const result2 = await attributor.processInboundMessage(
      {
        id: 'msg-in-2',
        organizationId: orgId,
        conversationId: 'conv-1',
        contactId,
        content: 'Resposta automática do WhatsApp Business',
        createdAt: autoReply2,
      },
      {
        id: 'msg-out-1',
        conversationId: 'conv-1',
        createdAt: outboundSentAt,
        sentAt: outboundSentAt,
      }
    );

    assert.equal(result2.outcome, 'ignored');
    assert.equal(result2.reason, 'auto_reply_rejected');
    assert.equal(result2.deltaMs, 1000);

    const currentLead2 = leadManager.getLead(lead.id);
    assert.equal(currentLead2?.stageId, 'stage-novo');
  });

  it('moves lead automatically to "em andamento" upon valid customer response (> 1000ms) (ADR 0042)', async () => {
    const { leadManager, attributor, funnel } = setup();

    const contactId = 'cnt-valid-2';
    const lead = leadManager.createLead({
      organizationId: orgId,
      funnelId: funnel.id,
      contactId,
      stageId: 'stage-novo',
    });

    const outboundSentAt = new Date('2026-09-03T15:00:00.000Z');
    // Customer takes 8 seconds to type and send a reply
    const customerReplyAt = new Date('2026-09-03T15:00:08.000Z');

    const result = await attributor.processInboundMessage(
      {
        id: 'msg-in-real',
        organizationId: orgId,
        conversationId: 'conv-2',
        contactId,
        content: 'Olá! Gostaria de saber mais sobre a proposta enviada.',
        createdAt: customerReplyAt,
      },
      {
        id: 'msg-out-camp',
        conversationId: 'conv-2',
        createdAt: outboundSentAt,
        sentAt: outboundSentAt,
      }
    );

    assert.equal(result.outcome, 'advanced');
    assert.equal(result.leadId, lead.id);
    assert.equal(result.fromStageId, 'stage-novo');
    assert.equal(result.toStageId, 'stage-em-andamento');

    // Lead stage is updated
    const updatedLead = leadManager.getLead(lead.id);
    assert.equal(updatedLead?.stageId, 'stage-em-andamento');

    // Audit record was generated with system attribution
    assert.ok(result.auditRecord);
    assert.equal(result.auditRecord.actorType, 'system');
    assert.equal(result.auditRecord.action, 'crm.lead.move');
    assert.equal(result.auditRecord.metadata?.['fromStageId'], 'stage-novo');
    assert.equal(result.auditRecord.metadata?.['toStageId'], 'stage-em-andamento');
  });

  it('ignores inbound messages from contacts NOT existing in an imported base or CRM', async () => {
    const { leadManager, attributor, funnel } = setup();

    // Unknown contact not in imported base or CRM
    const contactId = 'cnt-unknown-stranger';

    const outboundSentAt = new Date('2026-09-03T15:00:00.000Z');
    const inboundAt = new Date('2026-09-03T15:05:00.000Z');

    const result = await attributor.processInboundMessage(
      {
        id: 'msg-stranger',
        organizationId: orgId,
        conversationId: 'conv-unknown',
        contactId,
        content: 'Quem é você?',
        createdAt: inboundAt,
      },
      {
        id: 'msg-out',
        conversationId: 'conv-unknown',
        createdAt: outboundSentAt,
      }
    );

    assert.equal(result.outcome, 'ignored');
    assert.equal(result.reason, 'contact_not_in_base_or_crm');
  });

  it('does NOT re-advance or regress leads that are already past the initial stage', async () => {
    const { leadManager, attributor, funnel } = setup();

    const contactId = 'cnt-valid-3';
    // Lead is already in progress
    const lead = leadManager.createLead({
      organizationId: orgId,
      funnelId: funnel.id,
      contactId,
      stageId: 'stage-em-andamento',
    });

    const inboundAt = new Date('2026-09-03T15:10:00.000Z');
    const result = await attributor.processInboundMessage({
      id: 'msg-subsequent',
      organizationId: orgId,
      conversationId: 'conv-3',
      contactId,
      content: 'Mais uma mensagem do cliente',
      createdAt: inboundAt,
    });

    assert.equal(result.outcome, 'ignored');
    assert.equal(result.reason, 'lead_not_in_initial_stage');

    const currentLead = leadManager.getLead(lead.id);
    assert.equal(currentLead?.stageId, 'stage-em-andamento');
  });

  it('signals ambiguous attribution to operator when contact has multiple active leads (ADR 0042)', async () => {
    const enterpriseFunnelManager = new FunnelManager({ edition: 'enterprise' });
    const f1 = enterpriseFunnelManager.createFunnel({ organizationId: orgId, name: 'Funil A' });
    const f2 = enterpriseFunnelManager.createFunnel({ organizationId: orgId, name: 'Funil B' });
    const leadManager = new LeadManager(enterpriseFunnelManager);

    const contactChecker: ContactExistenceChecker = {
      contactExistsInBaseOrCrm: () => true,
    };
    const attributor = new ResponseAttributor(enterpriseFunnelManager, leadManager, contactChecker);

    const contactId = 'cnt-valid-multi';
    const l1 = leadManager.createLead({ organizationId: orgId, funnelId: f1.id, contactId, stageId: 'stage-novo' });
    const l2 = leadManager.createLead({ organizationId: orgId, funnelId: f2.id, contactId, stageId: 'stage-novo' });

    const result = await attributor.processInboundMessage({
      id: 'msg-multi',
      organizationId: orgId,
      conversationId: 'conv-multi',
      contactId,
      content: 'Olá!',
      createdAt: new Date('2026-09-03T16:00:00.000Z'),
    });

    // Invariant ADR 0042: Ambiguous cases are flagged for operator review instead of moving leads silently
    assert.equal(result.outcome, 'ambiguous');
    assert.equal(result.reason, 'multiple_active_leads');
    assert.ok(result.leadIds?.includes(l1.id));
    assert.ok(result.leadIds?.includes(l2.id));
    assert.ok(result.operatorAlert?.includes('ADR 0042'));

    // Neither lead was moved!
    assert.equal(leadManager.getLead(l1.id)?.stageId, 'stage-novo');
    assert.equal(leadManager.getLead(l2.id)?.stageId, 'stage-novo');
  });
});
