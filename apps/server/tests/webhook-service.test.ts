import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { readClaimToken } from '@dispar-flux/auth';
import { DisparFluxServer } from '../src/server.js';
import { WebhookService } from '../src/webhooks/webhook-service.js';
import { Logger } from '../src/logger.js';

const silentLogger = new Logger({
  level: 'error',
  output: () => {},
});

describe('Webhook Service & HTTP Endpoints (Block C / Issue #10)', () => {
  let tempDir: string;
  let server: DisparFluxServer;
  let ownerToken: string;
  let orgId: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-webhook-srv-'));
    server = new DisparFluxServer(
      {
        port: 0,
        host: '127.0.0.1',
        dataDir: tempDir,
        nodeEnv: 'test',
        version: '0.0.1',
      },
      {
        logger: silentLogger,
        exitOnLockError: false,
      }
    );
    await server.start();

    // 1. Claim installation (creates owner)
    const claimCode = readClaimToken(tempDir);
    assert.ok(claimCode);

    const claimRes = await fetch(`${server.url}/api/v1/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimCode,
        organizationName: 'Webhook Test Org',
        ownerName: 'Bob Webhook',
        ownerEmail: 'bob@webhook.test',
        password: 'Password123!',
      }),
    });
    assert.equal(claimRes.status, 201);
    const claimData = (await claimRes.json()) as any;
    ownerToken = claimData.token;
    orgId = claimData.organizationId;
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('WebhookService Unit Logic', () => {
    it('creates, lists and gets subscriptions with HMAC secret generation', () => {
      const db = (server as any).db;
      const service = new WebhookService(db);

      const sub = service.createSubscription(orgId, {
        targetUrl: 'https://example.com/webhook',
        events: ['contact.created', 'lead.stage_changed'],
      });

      assert.ok(sub.id.startsWith('wh_sub_'));
      assert.equal(sub.targetUrl, 'https://example.com/webhook');
      assert.equal(sub.events.length, 2);
      assert.ok(sub.secret.length >= 32);
      assert.equal(sub.isActive, true);

      const list = service.listSubscriptions(orgId);
      assert.ok(list.some((s) => s.id === sub.id));

      const retrieved = service.getSubscription(orgId, sub.id);
      assert.ok(retrieved);
      assert.equal(retrieved.id, sub.id);
      assert.equal(retrieved.targetUrl, sub.targetUrl);

      const deleted = service.deleteSubscription(orgId, sub.id);
      assert.equal(deleted, true);
      assert.equal(service.getSubscription(orgId, sub.id), null);
    });

    it('rejects invalid target URLs', () => {
      const db = (server as any).db;
      const service = new WebhookService(db);

      assert.throws(
        () => service.createSubscription(orgId, { targetUrl: 'ftp://bad-url' }),
        /targetUrl deve ser uma URL válida/
      );
    });

    it('dispatches webhook event with HMAC-SHA256 signature and records delivery log', async () => {
      const db = (server as any).db;
      const service = new WebhookService(db);

      let capturedHeaders: Record<string, string> = {};
      let capturedBody: string = '';

      service.setFetchFn(async (url: string, init?: RequestInit) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        capturedBody = String(init?.body || '');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const sub = service.createSubscription(orgId, {
        targetUrl: 'https://api.external.com/hooks',
        events: ['lead.stage_changed'],
        secret: 'my-super-secret-key-12345',
      });

      const count = await service.dispatch(orgId, 'lead.stage_changed', {
        leadId: 'ld_1',
        newStage: 'qualificado',
      });

      assert.equal(count, 1);
      assert.ok(capturedHeaders['X-DisparFlux-Signature']);
      assert.equal(capturedHeaders['X-DisparFlux-Event'], 'lead.stage_changed');

      // Verify HMAC-SHA256
      const expectedSig = crypto
        .createHmac('sha256', 'my-super-secret-key-12345')
        .update(capturedBody)
        .digest('hex');
      assert.equal(capturedHeaders['X-DisparFlux-Signature'], `sha256=${expectedSig}`);

      const deliveries = service.getDeliveries(orgId, sub.id);
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0].state, 'success');
      assert.equal(deliveries[0].responseStatus, 200);
      assert.equal(deliveries[0].attempts, 1);

      service.deleteSubscription(orgId, sub.id);
    });

    it('handles target failure and increments failureCount', async () => {
      const db = (server as any).db;
      const service = new WebhookService(db);

      service.setFetchFn(async () => {
        return new Response('Server Error', { status: 500 });
      });

      const sub = service.createSubscription(orgId, {
        targetUrl: 'https://api.external.com/failing',
        events: ['*'],
      });

      await service.dispatch(orgId, 'test.event', { foo: 'bar' });

      const updated = service.getSubscription(orgId, sub.id);
      assert.ok(updated);
      assert.equal(updated.failureCount, 1);

      const deliveries = service.getDeliveries(orgId, sub.id);
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0].state, 'failed');
      assert.equal(deliveries[0].responseStatus, 500);

      service.deleteSubscription(orgId, sub.id);
    });
  });

  describe('Webhook HTTP API Endpoints', () => {
    it('POST /api/v1/webhooks/subscriptions creates a new subscription', async () => {
      const res = await fetch(`${server.url}/api/v1/webhooks/subscriptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          targetUrl: 'https://webhook.site/test-endpoint',
          events: ['contact.created', 'opt_out.registered'],
        }),
      });

      assert.equal(res.status, 201);
      const data = (await res.json()) as any;
      assert.ok(data.id);
      assert.equal(data.targetUrl, 'https://webhook.site/test-endpoint');
      assert.deepEqual(data.events, ['contact.created', 'opt_out.registered']);

      // GET /api/v1/webhooks/subscriptions
      const listRes = await fetch(`${server.url}/api/v1/webhooks/subscriptions`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(listRes.status, 200);
      const listData = (await listRes.json()) as any;
      const subscriptions = listData.subscriptions || listData;
      assert.ok(subscriptions.some((s: any) => s.id === data.id));

      // DELETE /api/v1/webhooks/subscriptions/:id
      const delRes = await fetch(`${server.url}/api/v1/webhooks/subscriptions/${data.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      assert.equal(delRes.status, 200);
    });

    it('POST /api/v1/webhooks/test-dispatch triggers an event dispatch test', async () => {
      const res = await fetch(`${server.url}/api/v1/webhooks/test-dispatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          eventName: 'system.ping',
          data: { test: true },
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.success, true);
      assert.equal(typeof data.dispatchedTo, 'number');
    });
  });
});
