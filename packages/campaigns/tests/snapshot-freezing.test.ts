import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SafetyFloorViolationError } from '@dispar-flux/domain';
import { CampaignService } from '../src/engine/campaign-service.js';
import { BaseService } from '../src/bases/base-service.js';
import { ContactService } from '../src/contacts/contact-service.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('Campaign Snapshot Freezing (ADR 0035 & ADR 0060)', () => {
  let ctx: SeededTestContext;
  let campaignService: CampaignService;
  let baseService: BaseService;
  let contactService: ContactService;

  beforeEach(() => {
    ctx = createTestDatabase();
    campaignService = new CampaignService(ctx.conn);
    baseService = new BaseService(ctx.conn);
    contactService = new ContactService(ctx.conn);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('enforces Safety Floor bounds during campaign creation (ADR 0060)', () => {
    // Rejects pacing interval below 15s
    assert.throws(
      () => {
        campaignService.createCampaign({
          organizationId: ctx.organizationId,
          connectionId: ctx.connectionId,
          name: 'Pacing Invalido',
          messageTemplate: 'Ola {{nome}}',
          pacingIntervalSeconds: 10, // < 15s minimum
          dailyLimit: 200,
          confirmedResponsibility: true,
        });
      },
      (err) => err instanceof SafetyFloorViolationError
    );

    // Rejects daily limit exceeding ceiling of 1000
    assert.throws(
      () => {
        campaignService.createCampaign({
          organizationId: ctx.organizationId,
          connectionId: ctx.connectionId,
          name: 'Teto Invalido',
          messageTemplate: 'Ola {{nome}}',
          pacingIntervalSeconds: 20,
          dailyLimit: 2500, // > 1000 ceiling
          confirmedResponsibility: true,
        });
      },
      (err) => err instanceof SafetyFloorViolationError
    );
  });

  it('freezes audience snapshot and rendered message templates into campaign_jobs (ADR 0035)', () => {
    // 1. Create Base with contacts and imported fields
    const base = baseService.createBase({
      organizationId: ctx.organizationId,
      name: 'Base Black Friday',
      provenance: 'Lista de Clientes VIP',
      purpose: 'Envio de cupom exclusivo',
    });

    const { contact: c1 } = contactService.findOrCreateContact(ctx.organizationId, {
      phone: '11987654321',
      name: 'Alice Santos',
    });
    baseService.addMembership(base.id, c1.id, { cupom: 'DESC20', desconto: '20%' });

    const { contact: c2 } = contactService.findOrCreateContact(ctx.organizationId, {
      phone: '21988887777',
      name: 'Bernardo Lima',
    });
    baseService.addMembership(base.id, c2.id, { cupom: 'DESC30', desconto: '30%' });

    // 2. Create Campaign
    const campaign = campaignService.createCampaign({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      baseId: base.id,
      name: 'Disparo Black Friday VIP',
      messageTemplate: 'Olá {{nome}}! Use o cupom {{cupom}} para ganhar {{desconto}} de desconto.',
      pacingIntervalSeconds: 15,
      dailyLimit: 500,
      confirmedResponsibility: true,
    });

    assert.equal(campaign.status, 'draft');
    assert.equal(campaign.snapshotTotal, 0);

    // 3. Freeze Snapshot
    const { campaign: runningCampaign, jobsCount } = campaignService.freezeSnapshot(campaign.id);

    assert.equal(jobsCount, 2);
    assert.equal(runningCampaign.status, 'running');
    assert.equal(runningCampaign.snapshotTotal, 2);
    assert.ok(runningCampaign.startedAt);

    // 4. Verify rendered jobs in campaign_jobs
    const jobs = campaignService.listJobs(campaign.id);
    assert.equal(jobs.length, 2);

    const job1 = jobs.find((j) => j.normalizedPhone === '+5511987654321')!;
    assert.ok(job1);
    assert.equal(job1.status, 'pending');
    assert.equal(job1.renderedMessage, 'Olá Alice Santos! Use o cupom DESC20 para ganhar 20% de desconto.');

    const job2 = jobs.find((j) => j.normalizedPhone === '+5521988887777')!;
    assert.ok(job2);
    assert.equal(job2.status, 'pending');
    assert.equal(job2.renderedMessage, 'Olá Bernardo Lima! Use o cupom DESC30 para ganhar 30% de desconto.');

    // 5. Invariant (ADR 0035): Subsequent edits to the base or contacts DO NOT ALTER frozen jobs!
    // Add 3rd member to base
    const { contact: c3 } = contactService.findOrCreateContact(ctx.organizationId, {
      phone: '31977778888',
      name: 'Carlos Novo',
    });
    baseService.addMembership(base.id, c3.id, { cupom: 'DESC10', desconto: '10%' });

    // Edit Alice's canonical name
    contactService.updateCanonicalProfile(c1.id, ctx.memberId, {
      name: 'Alice Modificada Depois',
    });

    // Verify campaign_jobs remain strictly frozen
    const jobsAfterEdits = campaignService.listJobs(campaign.id);
    assert.equal(jobsAfterEdits.length, 2, 'Must still contain exactly the original 2 frozen jobs');

    const aliceJob = jobsAfterEdits.find((j) => j.normalizedPhone === '+5511987654321')!;
    assert.equal(
      aliceJob.renderedMessage,
      'Olá Alice Santos! Use o cupom DESC20 para ganhar 20% de desconto.',
      'Rendered message must remain frozen from the moment of campaign start'
    );
  });

  it('rejects freezing snapshot if operational responsibility is not confirmed (ADR 0036 & ADR 0060)', () => {
    const base = baseService.createBase({
      organizationId: ctx.organizationId,
      name: 'Base Qualquer',
      provenance: 'Origem',
      purpose: 'Finalidade',
    });

    // Create campaign with confirmedResponsibility = false
    const campaign = campaignService.createCampaign({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      baseId: base.id,
      name: 'Campanha Sem Confirmacao',
      messageTemplate: 'Ola {{nome}}',
      pacingIntervalSeconds: 30,
      dailyLimit: 200,
      confirmedResponsibility: false,
    });

    assert.throws(
      () => {
        campaignService.freezeSnapshot(campaign.id);
      },
      (err) => err instanceof SafetyFloorViolationError
    );
  });
});
