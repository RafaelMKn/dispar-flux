import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWebSocketEvent,
  isWebSocketEvent,
  SystemEvent,
  ConnectionEvent,
  CampaignEvent,
  MessageEvent,
  DisparWebSocketEvent,
} from '../src/index.js';

describe('Contracts: WebSocket Events', () => {
  it('creates and validates SystemEvent', () => {
    const event = createWebSocketEvent('system.status_changed', {
      status: 'maintenance',
      message: 'Sistema em manutenção programada',
      timestamp: new Date().toISOString(),
    });

    assert.equal(event.type, 'system.status_changed');
    assert.ok(event.id.startsWith('evt_'));
    assert.ok(isWebSocketEvent(event));
  });

  it('creates and validates ConnectionEvent with QR code and status', () => {
    const qrEvent = createWebSocketEvent('connection.qr', {
      connectionId: 'conn-1',
      status: 'qr',
      qrCode: '2@ABCDEF123456...',
    });

    assert.equal(qrEvent.type, 'connection.qr');
    assert.equal(qrEvent.payload.status, 'qr');
    assert.ok(isWebSocketEvent(qrEvent));
  });

  it('creates and validates CampaignEvent with progress metrics', () => {
    const progressEvent = createWebSocketEvent('campaign.progress', {
      campaignId: 'cmp-1',
      status: 'running',
      sentCount: 50,
      failedCount: 2,
      unknownCount: 0,
      totalCount: 100,
      progressPercent: 50,
    });

    assert.equal(progressEvent.type, 'campaign.progress');
    assert.equal(progressEvent.payload.sentCount, 50);
    assert.equal(progressEvent.payload.progressPercent, 50);
    assert.ok(isWebSocketEvent(progressEvent));
  });

  it('creates and validates MessageEvent with delivery details', () => {
    const messageEvent = createWebSocketEvent('message.received', {
      messageId: 'msg-1',
      conversationId: 'conv-1',
      contactId: 'cnt-1',
      connectionId: 'conn-1',
      direction: 'inbound',
      type: 'manual',
      kind: 'inbound',
      content: 'Gostaria de saber mais sobre o plano',
      status: 'delivered',
      timestamp: new Date().toISOString(),
    });

    assert.equal(messageEvent.type, 'message.received');
    assert.equal(messageEvent.payload.direction, 'inbound');
    assert.ok(isWebSocketEvent(messageEvent));
  });

  it('isWebSocketEvent rejects invalid objects', () => {
    assert.equal(isWebSocketEvent(null), false);
    assert.equal(isWebSocketEvent(undefined), false);
    assert.equal(isWebSocketEvent({}), false);
    assert.equal(isWebSocketEvent({ id: '1', type: 'foo' }), false);
    assert.equal(isWebSocketEvent('not-an-event'), false);
  });
});
