import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanSendAutomatedMessage,
  OptOutViolationError,
  InvariantViolationError,
} from '@dispar-flux/domain';
import { setupTestDatabase, type TestContext } from './test-helpers.js';
import {
  ConversationRepository,
  MessageRepository,
  LidJidRepository,
  ConversationService,
  ManualResponseService,
  type CampaignQueueTracker,
  type OutboundMessageDispatcher,
  type SendOutboundResult,
} from '../src/index.js';

describe('Inbox: Manual Response Dispatch (ADR 0027, ADR 0043, ADR 0045)', () => {
  let ctx: TestContext;
  let convRepo: ConversationRepository;
  let msgRepo: MessageRepository;
  let lidJidRepo: LidJidRepository;
  let convService: ConversationService;
  let dispatchedMessages: { connectionId: string; to: string; content: string }[];
  let dispatcher: OutboundMessageDispatcher;
  let queueEnqueuedJobs: unknown[];
  let dailyLimitsRemaining: number;
  let campaignQueue: CampaignQueueTracker;
  let manualService: ManualResponseService;

  beforeEach(() => {
    ctx = setupTestDatabase();
    convRepo = new ConversationRepository(ctx.conn);
    msgRepo = new MessageRepository(ctx.conn);
    lidJidRepo = new LidJidRepository(ctx.conn);
    convService = new ConversationService(convRepo, msgRepo);

    dispatchedMessages = [];
    dispatcher = {
      async sendDirectly(params): Promise<SendOutboundResult> {
        dispatchedMessages.push({
          connectionId: params.connectionId,
          to: params.to,
          content: params.content,
        });
        return {
          externalId: `ext_manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          sentAt: new Date(),
        };
      },
    };

    queueEnqueuedJobs = [];
    dailyLimitsRemaining = 100;
    campaignQueue = {
      getRemainingDailyLimit: (_connId: string) => dailyLimitsRemaining,
      consumeDailyLimit: (_connId: string, count = 1) => {
        dailyLimitsRemaining -= count;
      },
      enqueueCampaignJob: async (job: unknown) => {
        queueEnqueuedJobs.push(job);
      },
      getDailySendsCount: () => 100 - dailyLimitsRemaining,
    };

    manualService = new ManualResponseService(
      ctx.conn,
      convService,
      msgRepo,
      lidJidRepo,
      dispatcher,
      campaignQueue
    );
  });

  afterEach(() => {
    ctx.conn.close();
  });

  it('sends manual response immediately, bypassing campaign queue and not consuming daily limits (ADR 0043)', async () => {
    const initialLimit = dailyLimitsRemaining;

    const result = await manualService.sendManualResponse({
      organizationId: ctx.organizationId,
      connectionId: ctx.connection1Id,
      contactId: ctx.contact1Id,
      senderMemberId: ctx.operatorId,
      content: 'Olá Ana! Como posso ajudar você hoje?',
    });

    // 1. Sent immediately via dispatcher
    assert.equal(dispatchedMessages.length, 1);
    assert.equal(dispatchedMessages[0]?.to, '5511988881111');
    assert.equal(dispatchedMessages[0]?.content, 'Olá Ana! Como posso ajudar você hoje?');

    // 2. Campaign queue bypassed
    assert.equal(queueEnqueuedJobs.length, 0, 'Campaign queue enqueue must NOT be invoked');

    // 3. Daily prospecting limits untouched
    assert.equal(
      dailyLimitsRemaining,
      initialLimit,
      'Manual response must NOT consume daily prospecting limits (ADR 0043)'
    );

    // 4. Message stored in DB with valid metadata
    assert.equal(result.message.direction, 'outbound');
    assert.equal(result.message.type, 'manual');
    assert.equal(result.message.kind, 'manual');
    assert.equal(result.message.senderMemberId, ctx.operatorId);
    assert.equal(result.message.status, 'sent');
    assert.ok(result.message.externalId);

    // 5. Conversation updated
    const conv = convRepo.findById(result.conversation.id);
    assert.ok(conv?.lastMessageAt);
  });

  it('allows manual response to opted-out contacts without clearing opt-out status (ADR 0043 & ADR 0045)', async () => {
    // Flag Ana as opted-out
    const now = new Date().toISOString();
    ctx.conn
      .prepare('UPDATE contacts SET is_opted_out = 1 WHERE id = ?')
      .run(ctx.contact1Id);

    ctx.conn
      .prepare(`
        INSERT INTO opt_outs (id, organization_id, normalized_phone, contact_id, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run('opt_1', ctx.organizationId, '5511988881111', ctx.contact1Id, 'Solicitou descadastro', now);

    // Verify that automated sending is blocked by opt-out rule
    assert.throws(
      () => {
        assertCanSendAutomatedMessage({
          normalizedPhone: '5511988881111',
          optOuts: [
            {
              id: 'opt_1',
              organizationId: ctx.organizationId,
              normalizedPhone: '5511988881111',
              contactId: ctx.contact1Id,
              createdAt: new Date(now),
            },
          ],
        });
      },
      (err: unknown) => err instanceof OptOutViolationError
    );

    // Send manual response (ADR 0043: explicitly allowed)
    const result = await manualService.sendManualResponse({
      organizationId: ctx.organizationId,
      connectionId: ctx.connection1Id,
      contactId: ctx.contact1Id,
      senderMemberId: ctx.ownerId,
      content: 'Compreendo sua solicitação. Seus dados estão protegidos.',
    });

    assert.equal(result.contactWasOptedOut, true);
    assert.equal(dispatchedMessages.length, 1);
    assert.equal(result.message.content, 'Compreendo sua solicitação. Seus dados estão protegidos.');

    // CRITICAL INVARIANT (ADR 0043 & ADR 0045):
    // The manual response does NOT clear the opt-out status or reauthorize automated campaigns!
    const contactAfter = ctx.conn
      .prepare('SELECT is_opted_out FROM contacts WHERE id = ?')
      .get(ctx.contact1Id) as { is_opted_out: number };

    assert.equal(
      contactAfter.is_opted_out,
      1,
      'Contact MUST remain opted out after manual response (ADR 0043)'
    );

    const optOutRecord = ctx.conn
      .prepare('SELECT reauthorized_at FROM opt_outs WHERE id = ?')
      .get('opt_1') as { reauthorized_at: string | null };

    assert.equal(
      optOutRecord.reauthorized_at,
      null,
      'Opt-out record must NOT be automatically reauthorized (ADR 0045)'
    );
  });

  it('rejects manual response when sender member is deactivated or does not exist', async () => {
    // 1. Unknown member
    await assert.rejects(
      async () => {
        await manualService.sendManualResponse({
          organizationId: ctx.organizationId,
          connectionId: ctx.connection1Id,
          contactId: ctx.contact1Id,
          senderMemberId: 'mem_nonexistent_999',
          content: 'Test message',
        });
      },
      (err: unknown) => err instanceof InvariantViolationError
    );

    // 2. Deactivated member
    ctx.conn
      .prepare('UPDATE members SET is_active = 0 WHERE id = ?')
      .run(ctx.operatorId);

    await assert.rejects(
      async () => {
        await manualService.sendManualResponse({
          organizationId: ctx.organizationId,
          connectionId: ctx.connection1Id,
          contactId: ctx.contact1Id,
          senderMemberId: ctx.operatorId,
          content: 'Test message',
        });
      },
      (err: unknown) => err instanceof InvariantViolationError && err.message.includes('deactivated')
    );
  });
});
