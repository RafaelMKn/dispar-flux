import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FunnelManager,
  LeadManager,
  DuplicateLeadError,
  CommunityEditionFunnelLimitError,
  InvalidStageError,
  DEFAULT_COMMERCIAL_STAGES,
} from '../src/index.js';
import { InvariantViolationError } from '@dispar-flux/domain';

describe('CRM: Funnel & Lead Management', () => {
  const orgId = 'org-crm-1';

  describe('Funnel Management & Community Edition Invariant (ADR 0037)', () => {
    it('creates a funnel with ordered default stages', () => {
      const funnelManager = new FunnelManager({ edition: 'community' });
      const funnel = funnelManager.createFunnel({
        organizationId: orgId,
        name: 'Funil de Vendas Padrão',
      });

      assert.equal(funnel.name, 'Funil de Vendas Padrão');
      assert.equal(funnel.organizationId, orgId);
      assert.equal(funnel.isActive, true);
      assert.equal(funnel.stages.length, DEFAULT_COMMERCIAL_STAGES.length);

      // Verify stages are strictly ordered
      for (let i = 0; i < funnel.stages.length; i++) {
        assert.equal(funnel.stages[i]?.order, i);
      }
      assert.equal(funnel.stages[0]?.name, 'novo');
      assert.equal(funnel.stages[1]?.name, 'em andamento');
    });

    it('enforces ADR 0037: Community Edition permits exactly 1 active Funnel per Organization', () => {
      const funnelManager = new FunnelManager({ edition: 'community' });

      // First active funnel succeeds
      const f1 = funnelManager.createFunnel({
        organizationId: orgId,
        name: 'Funil Ativo 1',
        isActive: true,
      });
      assert.ok(f1.id);

      // Attempting to create a second active funnel in Community Edition must throw CommunityEditionFunnelLimitError
      assert.throws(
        () => {
          funnelManager.createFunnel({
            organizationId: orgId,
            name: 'Funil Ativo 2',
            isActive: true,
          });
        },
        CommunityEditionFunnelLimitError
      );

      // Creating an inactive funnel is permitted
      const f2Inactive = funnelManager.createFunnel({
        organizationId: orgId,
        name: 'Funil Inativo 2',
        isActive: false,
      });
      assert.equal(f2Inactive.isActive, false);

      // Attempting to activate the second funnel while the first is active must throw
      assert.throws(
        () => {
          funnelManager.activateFunnel(f2Inactive.id);
        },
        CommunityEditionFunnelLimitError
      );

      // Deactivating the first funnel then allows activating the second
      funnelManager.deactivateFunnel(f1.id);
      const activatedF2 = funnelManager.activateFunnel(f2Inactive.id);
      assert.equal(activatedF2.isActive, true);
    });

    it('allows multiple active funnels in Enterprise edition', () => {
      const enterpriseManager = new FunnelManager({ edition: 'enterprise' });

      const f1 = enterpriseManager.createFunnel({
        organizationId: orgId,
        name: 'Funil B2B',
        isActive: true,
      });

      const f2 = enterpriseManager.createFunnel({
        organizationId: orgId,
        name: 'Funil B2C',
        isActive: true,
      });

      assert.ok(f1.id);
      assert.ok(f2.id);
      assert.equal(enterpriseManager.listFunnels(orgId).length, 2);
    });

    it('reorders and adds stages to a funnel', () => {
      const funnelManager = new FunnelManager();
      const funnel = funnelManager.createFunnel({
        organizationId: orgId,
        name: 'Custom Pipeline',
        stages: [
          { id: 'stg-1', name: 'Lead', order: 0 },
          { id: 'stg-2', name: 'Demonstração', order: 1 },
        ],
      });

      const updated = funnelManager.addStage(funnel.id, {
        id: 'stg-3',
        name: 'Fechamento',
        order: 2,
      });
      assert.equal(updated.stages.length, 3);
      assert.equal(updated.stages[2]?.id, 'stg-3');

      // Reorder stages
      const reordered = funnelManager.reorderStages(funnel.id, [
        { id: 'stg-3', order: 0 },
        { id: 'stg-1', order: 1 },
        { id: 'stg-2', order: 2 },
      ]);
      assert.equal(reordered.stages[0]?.id, 'stg-3');
    });
  });

  describe('Lead Management & Single Lead Invariant (ADR 0038)', () => {
    it('enforces ADR 0038: strictly 1 Lead per (Contact, Funnel)', () => {
      const funnelManager = new FunnelManager();
      const funnel = funnelManager.createFunnel({
        organizationId: orgId,
        name: 'Funil Comercial',
      });

      const leadManager = new LeadManager(funnelManager);
      const contactId = 'cnt-joao-1';

      // First lead in funnel succeeds
      const lead1 = leadManager.createLead({
        organizationId: orgId,
        funnelId: funnel.id,
        contactId,
        value: 5000,
        notes: 'Cliente potencial interessado no plano anual',
      });

      assert.equal(lead1.contactId, contactId);
      assert.equal(lead1.funnelId, funnel.id);
      assert.equal(lead1.value, 5000);
      assert.equal(lead1.stageId, 'stage-novo'); // defaults to initial stage

      // Attempting to create another lead for the same contact in the same funnel MUST throw DuplicateLeadError
      assert.throws(
        () => {
          leadManager.createLead({
            organizationId: orgId,
            funnelId: funnel.id,
            contactId,
            value: 8000,
          });
        },
        DuplicateLeadError
      );

      // Same contact CAN participate in a different funnel (ADR 0038)
      const enterpriseFunnelManager = new FunnelManager({ edition: 'enterprise' });
      const fA = enterpriseFunnelManager.createFunnel({ organizationId: orgId, name: 'Funil Inbound' });
      const fB = enterpriseFunnelManager.createFunnel({ organizationId: orgId, name: 'Funil Outbound' });
      const enterpriseLeadManager = new LeadManager(enterpriseFunnelManager);

      const leadA = enterpriseLeadManager.createLead({
        organizationId: orgId,
        funnelId: fA.id,
        contactId,
      });
      const leadB = enterpriseLeadManager.createLead({
        organizationId: orgId,
        funnelId: fB.id,
        contactId,
      });

      assert.ok(leadA.id);
      assert.ok(leadB.id);
      assert.notEqual(leadA.funnelId, leadB.funnelId);
    });

    it('tracks lead stage transitions with audit tracking (ADR 0030 & ADR 0050)', () => {
      const funnelManager = new FunnelManager();
      const funnel = funnelManager.createFunnel({
        organizationId: orgId,
        name: 'Funil de Vendas',
      });
      const leadManager = new LeadManager(funnelManager);

      const lead = leadManager.createLead({
        organizationId: orgId,
        funnelId: funnel.id,
        contactId: 'cnt-maria-2',
        stageId: 'stage-novo',
      });

      // Move lead to 'stage-em-andamento' by an operator
      const moveResult = leadManager.moveLead(
        lead.id,
        'stage-em-andamento',
        { type: 'member', id: 'operator-123' },
        'Lead respondeu mensagem e demonstrou interesse'
      );

      assert.equal(moveResult.lead.stageId, 'stage-em-andamento');
      assert.equal(moveResult.previousStageId, 'stage-novo');
      assert.equal(moveResult.newStageId, 'stage-em-andamento');

      // Verify audit record
      assert.equal(moveResult.auditRecord.actorType, 'member');
      assert.equal(moveResult.auditRecord.actorId, 'operator-123');
      assert.equal(moveResult.auditRecord.targetType, 'lead');
      assert.equal(moveResult.auditRecord.targetId, lead.id);
      assert.equal(moveResult.auditRecord.action, 'crm.lead.move');
      assert.equal(moveResult.auditRecord.metadata?.['fromStageId'], 'stage-novo');
      assert.equal(moveResult.auditRecord.metadata?.['toStageId'], 'stage-em-andamento');
      assert.equal(moveResult.auditRecord.metadata?.['contactId'], 'cnt-maria-2');
    });

    it('rejects moving lead to non-existent stage', () => {
      const funnelManager = new FunnelManager();
      const funnel = funnelManager.createFunnel({
        organizationId: orgId,
        name: 'Funil',
      });
      const leadManager = new LeadManager(funnelManager);

      const lead = leadManager.createLead({
        organizationId: orgId,
        funnelId: funnel.id,
        contactId: 'cnt-3',
      });

      assert.throws(
        () => {
          leadManager.moveLead(lead.id, 'stage-inexistente', { type: 'system', id: 'system' });
        },
        InvalidStageError
      );
    });

    it('updates commercial deal value and notes', () => {
      const funnelManager = new FunnelManager();
      const funnel = funnelManager.createFunnel({ organizationId: orgId, name: 'Pipeline' });
      const leadManager = new LeadManager(funnelManager);

      const lead = leadManager.createLead({
        organizationId: orgId,
        funnelId: funnel.id,
        contactId: 'cnt-4',
        value: 1000,
        notes: 'Nota inicial',
      });

      const updated = leadManager.updateLead(lead.id, {
        value: 2500,
        notes: 'Nota atualizada com proposta enviada',
      });

      assert.equal(updated.value, 2500);
      assert.equal(updated.notes, 'Nota atualizada com proposta enviada');

      // Rejects negative value
      assert.throws(() => {
        leadManager.updateLead(lead.id, { value: -100 });
      }, InvariantViolationError);
    });
  });
});
