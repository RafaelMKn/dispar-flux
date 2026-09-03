import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CampaignService } from '../src/engine/campaign-service.js';
import { BaseService } from '../src/bases/base-service.js';
import { ContactService } from '../src/contacts/contact-service.js';
import { SerialAutomationQueue } from '../src/engine/serial-queue.js';
import { CampaignExecutionEngine } from '../src/engine/execution-engine.js';
import type { MessagingDispatcher, SendMessageParams, SendMessageResult } from '../src/engine/types.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('Serial Automation Queue, Pacing & Daily Quota Ceiling (ADR 0027 & ADR 0060)', () => {
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

  it('Serial Automation Queue strictly serializes execution per connection (ADR 0027)', async () => {
    const queue = new SerialAutomationQueue();
    const executionOrder: string[] = [];
    let concurrentCount = 0;
    let maxConcurrency = 0;

    const runJob = async (id: string, durationMs: number) => {
      return queue.runExclusive(ctx.connectionId, async () => {
        concurrentCount++;
        maxConcurrency = Math.max(maxConcurrency, concurrentCount);
        executionOrder.push(`start-${id}`);
        await new Promise((r) => setTimeout(r, durationMs));
        executionOrder.push(`finish-${id}`);
        concurrentCount--;
      });
    };

    // Trigger 3 jobs concurrently on the same connection
    await Promise.all([
      runJob('job1', 30),
      runJob('job2', 20),
      runJob('job3', 10),
    ]);

    // Max concurrency must be exactly 1 (strictly serialized)
    assert.equal(maxConcurrency, 1, 'Max concurrency on connection must be strictly 1');
    assert.deepEqual(executionOrder, [
      'start-job1',
      'finish-job1',
      'start-job2',
      'finish-job2',
      'start-job3',
      'finish-job3',
    ]);
  });

  it('enforces pacing interval between consecutive automated dispatches (minimum 15s) (ADR 0060)', async () => {
    const sleepCalls: number[] = [];
    const mockSleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const dispatchedMessages: SendMessageParams[] = [];
    const mockDispatcher: MessagingDispatcher = {
      sendMessage: async (params) => {
        dispatchedMessages.push(params);
        return { success: true, messageId: `msg-${Date.now()}` };
      },
    };

    const engine = new CampaignExecutionEngine(ctx.conn, mockDispatcher, {
      sleepFn: mockSleep,
    });

    // 1. Create Base with 3 contacts
    const base = baseService.createBase({
      organizationId: ctx.organizationId,
      name: 'Base Pacing Test',
      provenance: 'Teste Pacing',
      purpose: 'Verificar intervalo de seguranca',
    });

    for (let i = 1; i <= 3; i++) {
      const { contact } = contactService.findOrCreateContact(ctx.organizationId, {
        phone: `1198765432${i}`,
        name: `Destinatario ${i}`,
      });
      baseService.addMembership(base.id, contact.id);
    }

    // 2. Create campaign with pacing = 15 seconds
    const campaign = campaignService.createCampaign({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      baseId: base.id,
      name: 'Campanha Pacing 15s',
      messageTemplate: 'Olá {{nome}}',
      pacingIntervalSeconds: 15,
      dailyLimit: 200,
      confirmedResponsibility: true,
    });

    // 3. Freeze snapshot and start
    await engine.startCampaign(campaign.id);

    // Verify all 3 messages dispatched
    assert.equal(dispatchedMessages.length, 3);

    // Verify pacing: between message 1 and 2, and between message 2 and 3, sleep must have been called
    // with approximately 15,000 ms (>= 14,000 ms due to slight execution delta)
    assert.equal(sleepCalls.length, 2, 'Must enforce pacing interval between 1->2 and 2->3');
    for (const sleepMs of sleepCalls) {
      assert.ok(
        sleepMs >= 14500 && sleepMs <= 15000,
        `Expected pacing sleep close to 15000ms, got ${sleepMs}ms`
      );
    }

    // Verify all 3 jobs marked sent
    const updated = campaignService.getCampaign(campaign.id)!;
    assert.equal(updated.sentCount, 3);
    assert.equal(updated.status, 'completed');
  });

  it('enforces daily sending quota ceiling and pauses campaign when ceiling is reached (ADR 0060)', async () => {
    const mockSleep = async () => {};
    const dispatchedMessages: SendMessageParams[] = [];

    const mockDispatcher: MessagingDispatcher = {
      sendMessage: async (params) => {
        dispatchedMessages.push(params);
        return { success: true, messageId: `msg-${Date.now()}` };
      },
    };

    const engine = new CampaignExecutionEngine(ctx.conn, mockDispatcher, {
      sleepFn: mockSleep,
    });

    // 1. Create Base with 5 contacts
    const base = baseService.createBase({
      organizationId: ctx.organizationId,
      name: 'Base Teto Diario',
      provenance: 'Teste Teto',
      purpose: 'Verificar limite diário',
    });

    for (let i = 1; i <= 5; i++) {
      const { contact } = contactService.findOrCreateContact(ctx.organizationId, {
        phone: `1199999000${i}`,
        name: `Contato ${i}`,
      });
      baseService.addMembership(base.id, contact.id);
    }

    // 2. Create campaign with dailyLimit = 2 (lower limit to test quota pause)
    const campaign = campaignService.createCampaign({
      organizationId: ctx.organizationId,
      connectionId: ctx.connectionId,
      baseId: base.id,
      name: 'Campanha Limite 2',
      messageTemplate: 'Msg {{nome}}',
      pacingIntervalSeconds: 15,
      dailyLimit: 2, // daily limit of 2 messages
      confirmedResponsibility: true,
    });

    // 3. Start campaign
    await engine.startCampaign(campaign.id);

    // Exactly 2 messages should have been sent before hitting daily quota
    assert.equal(dispatchedMessages.length, 2);

    const pausedCampaign = campaignService.getCampaign(campaign.id)!;
    assert.equal(pausedCampaign.status, 'paused', 'Campaign must pause when daily limit ceiling is reached');
    assert.equal(pausedCampaign.sentCount, 2);
    assert.ok(pausedCampaign.pausedAt);

    // 3 jobs must still be pending
    const pendingJobs = campaignService.getPendingJobs(campaign.id);
    assert.equal(pendingJobs.length, 3);
  });
});
