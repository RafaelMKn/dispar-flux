import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FollowUpRuleEngine,
  SerialAutomationQueue,
  SAFETY_FLOOR_MIN_PACING_SECONDS,
  SAFETY_FLOOR_MAX_DAILY_LIMIT,
  SafetyFloorQueueError,
  type SimpleConversation,
  type SimpleMessage,
  type AutomationJob,
} from '../src/index.js';
import type { CrmLead } from '../src/lead/types.js';

describe('CRM: Follow-up Automation Pipeline (ADR 0027, 0040, 0043, 0060)', () => {
  const orgId = 'org-crm-fu';
  const funnelId = 'fnl-1';
  const connectionId = 'conn-1';

  describe('Follow-up Rule Engine & Non-responsive Detection', () => {
    it('detects non-responsive leads after configured interval and ignores responsive ones', async () => {
      const engine = new FollowUpRuleEngine();

      // Rule: in 'stage-novo', follow-up after 24h (86400s)
      const rule = engine.createRule({
        organizationId: orgId,
        funnelId,
        stageId: 'stage-novo',
        name: 'Follow-up 24h Sem Resposta',
        delayIntervalSeconds: 86400,
        messageTemplate: 'Olá {{name}}, tudo bem? Ainda tem interesse?',
      });

      const now = new Date('2026-09-03T15:00:00.000Z');
      const outboundOlderThan24h = new Date('2026-09-02T10:00:00.000Z'); // 29 hours ago
      const outboundRecent = new Date('2026-09-03T12:00:00.000Z');       // 3 hours ago

      const leadNonResponsive: CrmLead = {
        id: 'lead-nr',
        organizationId: orgId,
        funnelId,
        contactId: 'cnt-nr',
        stageId: 'stage-novo',
        createdAt: outboundOlderThan24h,
        updatedAt: outboundOlderThan24h,
      };

      const leadResponsive: CrmLead = {
        id: 'lead-resp',
        organizationId: orgId,
        funnelId,
        contactId: 'cnt-resp',
        stageId: 'stage-novo',
        createdAt: outboundOlderThan24h,
        updatedAt: outboundOlderThan24h,
      };

      const leadRecent: CrmLead = {
        id: 'lead-recent',
        organizationId: orgId,
        funnelId,
        contactId: 'cnt-recent',
        stageId: 'stage-novo',
        createdAt: outboundRecent,
        updatedAt: outboundRecent,
      };

      const conversations: SimpleConversation[] = [
        { id: 'conv-nr', organizationId: orgId, connectionId, contactId: 'cnt-nr' },
        { id: 'conv-resp', organizationId: orgId, connectionId, contactId: 'cnt-resp' },
        { id: 'conv-recent', organizationId: orgId, connectionId, contactId: 'cnt-recent' },
      ];

      const messages: SimpleMessage[] = [
        // Non-responsive contact: only outbound 29h ago, no response
        {
          id: 'msg-1',
          conversationId: 'conv-nr',
          direction: 'outbound',
          createdAt: outboundOlderThan24h,
          sentAt: outboundOlderThan24h,
        },
        // Responsive contact: outbound 29h ago, but customer replied 20h ago
        {
          id: 'msg-2',
          conversationId: 'conv-resp',
          direction: 'outbound',
          createdAt: outboundOlderThan24h,
          sentAt: outboundOlderThan24h,
        },
        {
          id: 'msg-3',
          conversationId: 'conv-resp',
          direction: 'inbound',
          createdAt: new Date('2026-09-02T19:00:00.000Z'), // replied!
        },
        // Recent contact: outbound sent only 3h ago (delay is 24h)
        {
          id: 'msg-4',
          conversationId: 'conv-recent',
          direction: 'outbound',
          createdAt: outboundRecent,
          sentAt: outboundRecent,
        },
      ];

      const candidates = await engine.evaluateNonResponsiveLeads({
        organizationId: orgId,
        funnelId,
        leads: [leadNonResponsive, leadResponsive, leadRecent],
        conversations,
        messages,
        now,
      });

      // Only leadNonResponsive should be detected!
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0]?.contactId, 'cnt-nr');
      assert.equal(candidates[0]?.rule.id, rule.id);
      assert.ok(candidates[0]!.elapsedSeconds >= 86400);

      // Generate follow-up job
      const contactAttributes = new Map<string, { name?: string }>([
        ['cnt-nr', { name: 'Carlos Eduardo' }],
      ]);
      const jobs = engine.generateFollowUpJobs(candidates, connectionId, contactAttributes, now);

      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.type, 'follow_up');
      assert.equal(jobs[0]?.contactId, 'cnt-nr');
      assert.equal(jobs[0]?.status, 'pending');
      assert.equal(jobs[0]?.renderedMessage, 'Olá Carlos Eduardo, tudo bem? Ainda tem interesse?');
    });

    it('enforces ADR 0040 & ADR 0043: Opt-out blocks follow-up evaluation', async () => {
      const engine = new FollowUpRuleEngine();
      engine.createRule({
        organizationId: orgId,
        funnelId,
        stageId: 'stage-novo',
        name: 'Follow-up',
        delayIntervalSeconds: 3600,
        messageTemplate: 'Olá!',
      });

      const now = new Date('2026-09-03T15:00:00.000Z');
      const outboundTime = new Date('2026-09-03T10:00:00.000Z'); // 5h ago

      const lead: CrmLead = {
        id: 'lead-optout',
        organizationId: orgId,
        funnelId,
        contactId: 'cnt-optout',
        stageId: 'stage-novo',
        createdAt: outboundTime,
        updatedAt: outboundTime,
      };

      const conversations: SimpleConversation[] = [
        { id: 'conv-opt', organizationId: orgId, connectionId, contactId: 'cnt-optout' },
      ];
      const messages: SimpleMessage[] = [
        { id: 'm-opt', conversationId: 'conv-opt', direction: 'outbound', createdAt: outboundTime },
      ];

      // Opt-out returns true for this contact
      const optOutCheckFn = (contactId: string) => contactId === 'cnt-optout';

      const candidates = await engine.evaluateNonResponsiveLeads({
        organizationId: orgId,
        funnelId,
        leads: [lead],
        conversations,
        messages,
        optOutCheckFn,
        now,
      });

      // Blocked by opt-out!
      assert.equal(candidates.length, 0);
    });

    it('respects maxAttempts per rule', async () => {
      const engine = new FollowUpRuleEngine();
      const rule = engine.createRule({
        organizationId: orgId,
        funnelId,
        stageId: 'stage-novo',
        name: 'Single Follow-up Rule',
        delayIntervalSeconds: 3600,
        messageTemplate: 'Follow-up',
        maxAttempts: 1,
      });

      const now = new Date('2026-09-03T15:00:00.000Z');
      const outboundTime = new Date('2026-09-03T10:00:00.000Z');

      const lead: CrmLead = {
        id: 'lead-capped',
        organizationId: orgId,
        funnelId,
        contactId: 'cnt-capped',
        stageId: 'stage-novo',
        createdAt: outboundTime,
        updatedAt: outboundTime,
      };

      const conversations: SimpleConversation[] = [
        { id: 'conv-cap', organizationId: orgId, connectionId, contactId: 'cnt-capped' },
      ];
      const messages: SimpleMessage[] = [
        { id: 'm-cap', conversationId: 'conv-cap', direction: 'outbound', createdAt: outboundTime },
      ];

      // Existing sent job already recorded for this lead & rule
      const existingJobs: AutomationJob[] = [
        {
          id: 'prev-job-1',
          organizationId: orgId,
          connectionId,
          contactId: 'cnt-capped',
          leadId: 'lead-capped',
          funnelId,
          stageId: 'stage-novo',
          ruleId: rule.id,
          type: 'follow_up',
          renderedMessage: 'Follow-up',
          status: 'sent',
          scheduledFor: outboundTime,
          attemptCount: 1,
          createdAt: outboundTime,
          updatedAt: outboundTime,
        },
      ];

      const candidates = await engine.evaluateNonResponsiveLeads({
        organizationId: orgId,
        funnelId,
        leads: [lead],
        conversations,
        messages,
        existingJobs,
        now,
      });

      assert.equal(candidates.length, 0, 'Should not generate candidate when maxAttempts reached');
    });
  });

  describe('Serial Automation Queue (ADR 0027 & Safety Floor ADR 0060)', () => {
    it('enforces Safety Floor bounds on queue configuration (ADR 0060)', () => {
      // Rejects pacing below minimum (15s)
      assert.throws(
        () => {
          new SerialAutomationQueue({
            connectionId,
            organizationId: orgId,
            pacingIntervalSeconds: 5, // below 15
          });
        },
        SafetyFloorQueueError
      );

      // Rejects daily ceiling above maximum (1000)
      assert.throws(
        () => {
          new SerialAutomationQueue({
            connectionId,
            organizationId: orgId,
            dailyLimit: 2000, // above 1000
          });
        },
        SafetyFloorQueueError
      );

      // Allows valid minimum boundary configuration
      const validQueue = new SerialAutomationQueue({
        connectionId,
        organizationId: orgId,
        pacingIntervalSeconds: SAFETY_FLOOR_MIN_PACING_SECONDS,
        dailyLimit: SAFETY_FLOOR_MAX_DAILY_LIMIT,
      });
      assert.equal(validQueue.pacingIntervalSeconds, 15);
      assert.equal(validQueue.dailyLimit, 1000);
    });

    it('enforces pacing interval between serial dispatches', async () => {
      const queue = new SerialAutomationQueue({
        connectionId,
        organizationId: orgId,
        pacingIntervalSeconds: 20, // 20s pacing
        dailyLimit: 100,
      });

      const job1: AutomationJob = {
        id: 'job-1',
        organizationId: orgId,
        connectionId,
        contactId: 'cnt-1',
        leadId: 'lead-1',
        funnelId,
        stageId: 'stage-novo',
        type: 'follow_up',
        renderedMessage: 'Msg 1',
        status: 'pending',
        scheduledFor: new Date(),
        attemptCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const job2: AutomationJob = {
        id: 'job-2',
        organizationId: orgId,
        connectionId,
        contactId: 'cnt-2',
        leadId: 'lead-2',
        funnelId,
        stageId: 'stage-novo',
        type: 'follow_up',
        renderedMessage: 'Msg 2',
        status: 'pending',
        scheduledFor: new Date(),
        attemptCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      queue.enqueue(job1);
      queue.enqueue(job2);

      const t0 = new Date('2026-09-03T15:00:00.000Z');
      const executor = async () => ({ outcome: 'sent' as const });

      // First dispatch succeeds immediately
      const res1 = await queue.dispatchNext(executor, undefined, t0);
      assert.equal(res1.status, 'sent');
      assert.equal(queue.getDailySentCount(), 1);

      // Attempting second dispatch 5 seconds later (must wait 20s pacing)
      const t5 = new Date('2026-09-03T15:00:05.000Z');
      const res2 = await queue.dispatchNext(executor, undefined, t5);
      assert.equal(res2.status, 'pacing_wait');
      if (res2.status === 'pacing_wait') {
        assert.equal(res2.waitRemainingSeconds, 15);
      }

      // Dispatch 20 seconds later (pacing satisfied)
      const t20 = new Date('2026-09-03T15:00:20.000Z');
      const res3 = await queue.dispatchNext(executor, undefined, t20);
      assert.equal(res3.status, 'sent');
      assert.equal(queue.getDailySentCount(), 2);
    });

    it('enforces daily ceiling limit', async () => {
      const queue = new SerialAutomationQueue({
        connectionId,
        organizationId: orgId,
        pacingIntervalSeconds: 15,
        dailyLimit: 2, // Limit set to 2 for test
      });

      const makeJob = (id: string): AutomationJob => ({
        id,
        organizationId: orgId,
        connectionId,
        contactId: 'cnt-' + id,
        leadId: 'lead-' + id,
        funnelId,
        stageId: 'stage-novo',
        type: 'follow_up',
        renderedMessage: 'Hello',
        status: 'pending',
        scheduledFor: new Date(),
        attemptCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      queue.enqueue(makeJob('j1'));
      queue.enqueue(makeJob('j2'));
      queue.enqueue(makeJob('j3'));

      const t0 = new Date('2026-09-03T15:00:00.000Z');
      const executor = async () => ({ outcome: 'sent' as const });

      // Dispatch 1
      await queue.dispatchNext(executor, undefined, t0);
      // Dispatch 2 (16s later)
      const t16 = new Date('2026-09-03T15:00:16.000Z');
      await queue.dispatchNext(executor, undefined, t16);

      assert.equal(queue.getDailySentCount(), 2);

      // Dispatch 3 (daily limit of 2 reached)
      const t32 = new Date('2026-09-03T15:00:32.000Z');
      const res3 = await queue.dispatchNext(executor, undefined, t32);
      assert.equal(res3.status, 'daily_limit_reached');
      if (res3.status === 'daily_limit_reached') {
        assert.equal(res3.dailySentCount, 2);
        assert.equal(res3.dailyLimit, 2);
      }
    });

    it('cancels job before dispatch if contact opted out in the meantime (ADR 0040 & 0043)', async () => {
      const queue = new SerialAutomationQueue({
        connectionId,
        organizationId: orgId,
      });

      const job: AutomationJob = {
        id: 'job-opt-check',
        organizationId: orgId,
        connectionId,
        contactId: 'cnt-late-optout',
        leadId: 'lead-x',
        funnelId,
        stageId: 'stage-novo',
        type: 'follow_up',
        renderedMessage: 'Follow-up',
        status: 'pending',
        scheduledFor: new Date(),
        attemptCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      queue.enqueue(job);

      let sendExecuted = false;
      const executor = async () => {
        sendExecuted = true;
        return { outcome: 'sent' as const };
      };

      const evaluator = {
        isContactOptedOut: async () => true, // Opt-out was registered!
      };

      const res = await queue.dispatchNext(executor, evaluator);
      assert.equal(res.status, 'failed');
      assert.equal(sendExecuted, false, 'Send executor must NOT be called when contact opted out');
      if (res.status === 'failed') {
        assert.ok(res.reason.includes('Opt-out active for contact (ADR 0040)'));
      }
    });

    it('enforces ADR 0028: Envio Incerto ("unknown") is never retried automatically', async () => {
      const queue = new SerialAutomationQueue({
        connectionId,
        organizationId: orgId,
      });

      const job: AutomationJob = {
        id: 'job-uncertain',
        organizationId: orgId,
        connectionId,
        contactId: 'cnt-uncertain',
        leadId: 'lead-u',
        funnelId,
        stageId: 'stage-novo',
        type: 'follow_up',
        renderedMessage: 'Follow-up',
        status: 'pending',
        scheduledFor: new Date(),
        attemptCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      queue.enqueue(job);

      // Executor simulates network socket disconnect without acknowledgement
      const executor = async () => ({
        outcome: 'unknown' as const,
        error: 'Socket disconnected during write without ACK (ADR 0028 Envio Incerto)',
      });

      const res = await queue.dispatchNext(executor);
      assert.equal(res.status, 'unknown');
      if (res.status === 'unknown') {
        assert.equal(res.job.status, 'unknown');
        assert.ok(res.reason.includes('ADR 0028'));
      }

      // Queue is now empty; the unknown job was NOT put back into pending queue!
      assert.equal(queue.getQueueLength(), 0);
    });
  });
});
