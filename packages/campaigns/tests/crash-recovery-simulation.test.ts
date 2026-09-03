import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { canRetryJob } from '@dispar-flux/domain';
import { CampaignService } from '../src/engine/campaign-service.js';
import { BaseService } from '../src/bases/base-service.js';
import { ContactService } from '../src/contacts/contact-service.js';
import { CampaignExecutionEngine } from '../src/engine/execution-engine.js';
import type { MessagingDispatcher, SendMessageParams } from '../src/engine/types.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('Crash Recovery Simulation & Envio Incerto (ADR 0028)', () => {
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

  it('marks in-flight jobs as "unknown" during crash recovery, and NEVER retries them on resume (ADR 0028)', async () => {
    const dispatchLog: string[] = [];

    // 1. Create Base with 3 contacts
    const base = baseService.createBase({
      organizationId: ctx.organizationId,
      name: 'Base Crash Simulation',
      provenance: 'Teste de Resiliencia',
      purpose: 'Simular crash durante envio',
    });

    const { contact: c1 } = contactService.findOrCreateContact(ctx.organizationId, { phone: '11988881111', name: 'Destinatario 1' });
    const { contact: c2 } = contactService.findOrCreateContact(ctx.organizationId, { phone: '11988882222', name: 'Destinatario 2 (Crash)' });
    const { contact: c3 } = contactService.findOrCreateContact(ctx.organizationId, { phone: '11988883333', name: 'Destinatario 3' });

    baseService.addMembership(base.id, c1.id);
    baseService.addMembership(base.id, c2.id);
    baseService.addMembership(base.id, c3.id);

    // 2. Create campaign
    const campaign = campaignService.createCampaign({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      baseId: base.id,
      name: 'Campanha Resiliencia',
      messageTemplate: 'Oi {{nome}}',
      pacingIntervalSeconds: 15,
      dailyLimit: 200,
      confirmedResponsibility: true,
    });

    campaignService.freezeSnapshot(campaign.id);
    const jobs = campaignService.listJobs(campaign.id);
    const job2 = jobs.find((j) => j.contactId === c2.id)!;

    // 3. Mock dispatcher that simulates a sudden ungraceful crash on Job 2
    let crashed = false;
    const crashDispatcher: MessagingDispatcher = {
      sendMessage: async (params) => {
        dispatchLog.push(params.to);
        if (params.to === c2.normalizedPhone && !crashed) {
          crashed = true;
          // Simulate crash: unhandled fatal error / power interruption while in-flight
          throw new Error('FATAL_SIMULATED_PROCESS_CRASH');
        }
        return { success: true, messageId: `msg-${Date.now()}` };
      },
    };

    const engine1 = new CampaignExecutionEngine(ctx.conn, crashDispatcher, {
      sleepFn: async () => {},
    });

    // Simulate Job 2 entering 'sending' in DB and process crashing immediately
    // Job 1 has sent
    ctx.conn.prepare(`
      UPDATE campaign_jobs SET status = 'sent', sent_at = ?, updated_at = ? WHERE contact_id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), c1.id);
    ctx.conn.prepare(`UPDATE campaigns SET sent_count = 1 WHERE id = ?`).run(campaign.id);

    // Job 2 transitioned to 'sending' right before crash
    ctx.conn.prepare(`
      UPDATE campaign_jobs SET status = 'sending', updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), job2.id);

    // Campaign is currently paused/interrupted due to the crash
    ctx.conn.prepare(`
      UPDATE campaigns SET status = 'paused', paused_at = ? WHERE id = ?
    `).run(new Date().toISOString(), campaign.id);

    // 4. System restarts / recovery boots (new Engine instance)
    const normalDispatcher: MessagingDispatcher = {
      sendMessage: async (params) => {
        dispatchLog.push(params.to);
        return { success: true, messageId: `msg-${Date.now()}` };
      },
    };

    const engine2 = new CampaignExecutionEngine(ctx.conn, normalDispatcher, {
      sleepFn: async () => {},
    });

    // Run crash recovery
    const recoveredCount = engine2.recoverInterruptedJobs(campaign.id);
    assert.equal(recoveredCount, 1, 'Must recover exactly 1 in-flight job');

    // Verify Job 2 is now marked 'unknown' with ADR 0028 error reason
    const recoveredJob2 = campaignService.getJob(job2.id)!;
    assert.equal(recoveredJob2.status, 'unknown', 'Job must become "unknown" per ADR 0028');
    assert.ok(recoveredJob2.errorReason?.includes('ADR 0028'));

    // Invariant (ADR 0028): canRetryJob('unknown') must be FALSE
    assert.equal(canRetryJob('unknown'), false, 'Envio Incerto ("unknown") must never be retried automatically');

    // Verify campaign unknown_count is 1
    const campaignAfterRecovery = campaignService.getCampaign(campaign.id)!;
    assert.equal(campaignAfterRecovery.unknownCount, 1);

    // 5. Automatic Resumption:
    // Engine resumes the campaign. Invariant: It must SKIP the 'unknown' Job 2 and process Job 3!
    await engine2.resumeCampaign(campaign.id);

    // Verify dispatch log on resumption:
    // Only Job 3 was dispatched upon resumption! Job 2 was NOT resent!
    assert.deepEqual(
      dispatchLog,
      [c3.normalizedPhone],
      'Job 2 must NOT be retried on resume; only pending Job 3 should be sent'
    );

    // Verify final state
    const finalJob2 = campaignService.getJob(job2.id)!;
    assert.equal(finalJob2.status, 'unknown', 'Job 2 remains strictly "unknown"');

    const finalJob3 = campaignService.listJobs(campaign.id).find((j) => j.contactId === c3.id)!;
    assert.equal(finalJob3.status, 'sent', 'Job 3 is sent successfully');

    const finalCampaign = campaignService.getCampaign(campaign.id)!;
    assert.equal(finalCampaign.status, 'completed');
    assert.equal(finalCampaign.sentCount, 2, 'Total sent: Job 1 + Job 3');
    assert.equal(finalCampaign.unknownCount, 1, 'Total unknown: Job 2');
    assert.equal(finalCampaign.failedCount, 0);
  });

  it('supports campaign lifecycle controls: pause, resume, and cancel', async () => {
    const base = baseService.createBase({
      organizationId: ctx.organizationId,
      name: 'Base Lifecycle',
      provenance: 'Teste',
      purpose: 'Teste Controles',
    });

    const { contact } = contactService.findOrCreateContact(ctx.organizationId, { phone: '11988884444', name: 'Teste' });
    baseService.addMembership(base.id, contact.id);

    const campaign = campaignService.createCampaign({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      baseId: base.id,
      name: 'Campanha Lifecycle',
      messageTemplate: 'Oi',
      pacingIntervalSeconds: 15,
      dailyLimit: 100,
      confirmedResponsibility: true,
    });

    campaignService.freezeSnapshot(campaign.id);

    const mockDispatcher: MessagingDispatcher = {
      sendMessage: async () => ({ success: true, messageId: 'm1' }),
    };
    const engine = new CampaignExecutionEngine(ctx.conn, mockDispatcher, {
      sleepFn: async () => {},
    });

    // Pause
    const paused = engine.pauseCampaign(campaign.id);
    assert.equal(paused.status, 'paused');
    assert.ok(paused.pausedAt);

    // Resume
    const resumed = await engine.resumeCampaign(campaign.id);
    assert.equal(resumed.status, 'completed'); // Single job sends and completes

    // Cancel on fresh campaign
    const campaignToCancel = campaignService.createCampaign({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      baseId: base.id,
      name: 'Para Cancelar',
      messageTemplate: 'Tchau',
      pacingIntervalSeconds: 15,
      dailyLimit: 100,
      confirmedResponsibility: true,
    });

    const canceled = engine.cancelCampaign(campaignToCancel.id);
    assert.equal(canceled.status, 'canceled');
    assert.ok(canceled.canceledAt);
  });
});
