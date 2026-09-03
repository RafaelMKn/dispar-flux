import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOptOut, createSuppressionKey } from '@dispar-flux/domain';
import { CampaignService } from '../src/engine/campaign-service.js';
import { BaseService } from '../src/bases/base-service.js';
import { ContactService } from '../src/contacts/contact-service.js';
import { CampaignExecutionEngine } from '../src/engine/execution-engine.js';
import type { MessagingDispatcher, SendMessageParams } from '../src/engine/types.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('Opt-Out & Suppression Blocking at Dispatch (ADR 0035, ADR 0040, ADR 0044)', () => {
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

  it('blocks dispatch at moment of send if contact opted out after snapshot was frozen (ADR 0035 & ADR 0040)', async () => {
    const salt = 'opt-test-salt-2026';
    const sentDispatches: SendMessageParams[] = [];

    const mockDispatcher: MessagingDispatcher = {
      sendMessage: async (params) => {
        sentDispatches.push(params);
        return { success: true, messageId: `msg-${Date.now()}` };
      },
    };

    const engine = new CampaignExecutionEngine(ctx.conn, mockDispatcher, {
      sleepFn: async () => {}, // Instant pacing for tests
      suppressionSalt: salt,
    });

    // 1. Create Base with 3 contacts
    const base = baseService.createBase({
      organizationId: ctx.organizationId,
      name: 'Base Com Opt-Out Posterior',
      provenance: 'Auditoria Disparo',
      purpose: 'Validar bloqueio runtime',
    });

    const phone1 = '11988880001';
    const phone2 = '11988880002'; // Will opt-out after freeze
    const phone3 = '11988880003'; // Will be suppressed after freeze

    const { contact: c1 } = contactService.findOrCreateContact(ctx.organizationId, { phone: phone1, name: 'Normal 1' });
    const { contact: c2 } = contactService.findOrCreateContact(ctx.organizationId, { phone: phone2, name: 'Optou Fora' });
    const { contact: c3 } = contactService.findOrCreateContact(ctx.organizationId, { phone: phone3, name: 'Deletado LGPD' });

    baseService.addMembership(base.id, c1.id);
    baseService.addMembership(base.id, c2.id);
    baseService.addMembership(base.id, c3.id);

    // 2. Create campaign and freeze snapshot
    const campaign = campaignService.createCampaign({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      baseId: base.id,
      name: 'Campanha Checagem Opt-out',
      messageTemplate: 'Olá {{nome}}',
      pacingIntervalSeconds: 15,
      dailyLimit: 100,
      confirmedResponsibility: true,
    });

    // Freeze snapshot while all 3 are eligible
    const { jobsCount } = campaignService.freezeSnapshot(campaign.id);
    assert.equal(jobsCount, 3);

    // 3. AFTER snapshot freezing:
    // c2 registers an organization-wide opt-out
    const optOut = createOptOut({
      id: 'opt-runtime-1',
      organizationId: ctx.organizationId,
      normalizedPhone: c2.normalizedPhone,
      reason: 'Usuário pediu saída pelo WhatsApp',
    });
    ctx.conn.prepare(`
      INSERT INTO opt_outs (id, organization_id, normalized_phone, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(optOut.id, optOut.organizationId, optOut.normalizedPhone, optOut.reason, new Date().toISOString());

    // c3 is deleted under LGPD and receives a pseudonymous suppression key (ADR 0044)
    const suppressionKey = createSuppressionKey({
      id: 'sk-runtime-1',
      organizationId: ctx.organizationId,
      normalizedPhone: c3.normalizedPhone,
      salt,
    });
    ctx.conn.prepare(`
      INSERT INTO suppression_keys (id, organization_id, hash_key, created_at)
      VALUES (?, ?, ?, ?)
    `).run(suppressionKey.id, suppressionKey.organizationId, suppressionKey.hashKey, new Date().toISOString());

    // 4. Process Campaign
    await engine.processCampaign(campaign.id);

    // 5. Verification:
    // Only Contact 1 should have reached the dispatcher!
    assert.equal(sentDispatches.length, 1);
    assert.equal(sentDispatches[0]!.to, c1.normalizedPhone);

    const jobs = campaignService.listJobs(campaign.id);
    assert.equal(jobs.length, 3);

    // Job 1: Sent
    const job1 = jobs.find((j) => j.contactId === c1.id)!;
    assert.equal(job1.status, 'sent');
    assert.ok(job1.sentAt);

    // Job 2: Failed due to opt-out
    const job2 = jobs.find((j) => j.contactId === c2.id)!;
    assert.equal(job2.status, 'failed');
    assert.ok(job2.errorReason?.includes('opt-out'));

    // Job 3: Failed due to pseudonymous suppression
    const job3 = jobs.find((j) => j.contactId === c3.id)!;
    assert.equal(job3.status, 'failed');
    assert.ok(job3.errorReason?.includes('suppression key'));

    // Campaign metrics
    const finalCampaign = campaignService.getCampaign(campaign.id)!;
    assert.equal(finalCampaign.sentCount, 1);
    assert.equal(finalCampaign.failedCount, 2);
    assert.equal(finalCampaign.status, 'completed');
  });
});
