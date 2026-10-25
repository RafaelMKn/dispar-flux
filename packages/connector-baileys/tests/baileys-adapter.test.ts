import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DisconnectReason } from '@whiskeysockets/baileys';
import {
  BaileysConnector,
  DuplicateConnectionError,
  ConnectionNotFoundError,
  NotConnectedError,
  type QREventPayload,
  type StatusEventPayload,
  type InboundMessage,
  type HistorySyncPayload,
  type MessageStatusUpdatePayload,
} from '../src/index.js';

class MockWASocket {
  public ev = new EventEmitter();
  public sentMessages: Array<{ jid: string; content: any; options?: any }> = [];
  public historyRequests: Array<{ count: number; oldestKey: any; tsMs: number }> = [];
  public closed = false;

  async sendMessage(jid: string, content: any, options?: any) {
    this.sentMessages.push({ jid, content, options });
    return {
      key: { id: `msg_mock_${Date.now()}` },
    };
  }

  async fetchMessageHistory(count: number, oldestKey: any, tsMs: number) {
    this.historyRequests.push({ count, oldestKey, tsMs });
    return `req_hist_${Date.now()}`;
  }

  async onWhatsApp(...phoneNumbers: string[]) {
    return phoneNumbers.map((p) => ({
      jid: p.includes('@') ? p : `${p.replace(/\D/g, '')}@s.whatsapp.net`,
      exists: !p.includes('invalid'),
    }));
  }

  end() {
    this.closed = true;
  }
}

describe('Baileys Connector: Adapter Lifecycle & Operations (ADR 0002, 0005, 0010)', () => {
  let tempBaseDir: string;
  let connector: BaileysConnector;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-test-'));
    connector = new BaileysConnector();
  });

  afterEach(async () => {
    // Disconnect any lingering sessions
    await connector.disconnect('conn-1');
    await connector.disconnect('conn-2');
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  it('getStatus returns disconnected for uninitialized connection', () => {
    assert.equal(connector.getStatus('unknown-conn'), 'disconnected');
  });

  describe('Lifecycle: Connect, QR Generation, and Open Status', () => {
    it('manages connection states and captures QR code', async () => {
      let mockSocket: MockWASocket | null = null;
      const qrEvents: QREventPayload[] = [];
      const statusEvents: StatusEventPayload[] = [];

      connector.on('qr', (payload) => qrEvents.push(payload));
      connector.on('status', (payload) => statusEvents.push(payload));

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      assert.equal(connector.getStatus('conn-1'), 'connecting');
      assert.ok(mockSocket);

      // Simulate QR update from Baileys
      mockSocket.ev.emit('connection.update', {
        qr: '2@QRCODESTRINGDATA...',
      });

      assert.equal(connector.getStatus('conn-1'), 'qr');
      assert.equal(qrEvents.length, 1);
      assert.equal(qrEvents[0]?.connectionId, 'conn-1');
      assert.equal(qrEvents[0]?.qr, '2@QRCODESTRINGDATA...');

      // Simulate connection open
      mockSocket.ev.emit('connection.update', {
        connection: 'open',
      });

      assert.equal(connector.getStatus('conn-1'), 'connected');
      assert.ok(statusEvents.some((s) => s.status === 'connected'));
    });
  });

  describe('Single-Socket Exclusivity (ADR 0010)', () => {
    it('rejects duplicate connect attempt on same connectionId without replaceExisting', async () => {
      let socket1: MockWASocket | null = null;

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          socket1 = new MockWASocket();
          return socket1;
        },
      });

      assert.equal(connector.getStatus('conn-1'), 'connecting');

      // Attempt second connect on same connectionId -> MUST THROW DuplicateConnectionError
      await assert.rejects(
        async () => {
          await connector.connect('conn-1', {
            dataDir: tempBaseDir,
            replaceExisting: false,
          });
        },
        DuplicateConnectionError
      );
    });

    it('gracefully terminates and replaces existing socket when replaceExisting is true', async () => {
      let socket1: MockWASocket | null = null;
      let socket2: MockWASocket | null = null;

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          socket1 = new MockWASocket();
          return socket1;
        },
      });

      assert.ok(socket1);
      assert.equal(socket1.closed, false);

      // Second connect with replaceExisting = true
      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        replaceExisting: true,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          socket2 = new MockWASocket();
          return socket2;
        },
      });

      // Socket 1 was closed during replacement
      assert.equal(socket1.closed, true);
      assert.ok(socket2);
      assert.equal(socket2.closed, false);
      assert.equal(connector.getStatus('conn-1'), 'connecting');
    });
  });

  describe('Outbound Message Dispatch', () => {
    it('rejects sendMessage when connection does not exist or is not connected', async () => {
      // 1. Connection not found
      await assert.rejects(
        async () => {
          await connector.sendMessage({
            connectionId: 'non-existent',
            to: '5511998765432',
            content: 'Olá',
          });
        },
        ConnectionNotFoundError
      );

      // 2. Connection exists but not connected (connecting)
      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => new MockWASocket(),
      });

      await assert.rejects(
        async () => {
          await connector.sendMessage({
            connectionId: 'conn-1',
            to: '5511998765432',
            content: 'Olá',
          });
        },
        NotConnectedError
      );
    });

    it('successfully dispatches text and media messages when connected', async () => {
      let mockSocket: MockWASocket | null = null;

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      // Transition to connected
      mockSocket!.ev.emit('connection.update', { connection: 'open' });
      assert.equal(connector.getStatus('conn-1'), 'connected');

      // 1. Send text message
      const textResult = await connector.sendMessage({
        connectionId: 'conn-1',
        to: '11998765432',
        content: 'Teste de envio pelo conector',
      });

      assert.equal(textResult.status, 'sent');
      assert.ok(textResult.messageId);
      assert.equal(mockSocket!.sentMessages.length, 1);
      assert.equal(mockSocket!.sentMessages[0]?.jid, '5511998765432@s.whatsapp.net');
      assert.deepEqual(mockSocket!.sentMessages[0]?.content, { text: 'Teste de envio pelo conector' });

      // 2. Send media message (image)
      const mediaResult = await connector.sendMessage({
        connectionId: 'conn-1',
        to: '5511998765432@s.whatsapp.net',
        type: 'image',
        mediaUrl: 'https://disparflux.test/banner.png',
        content: 'Legenda da imagem',
      });

      assert.equal(mediaResult.status, 'sent');
      assert.equal(mockSocket!.sentMessages.length, 2);
      assert.equal(mockSocket!.sentMessages[1]?.content?.caption, 'Legenda da imagem');
      assert.deepEqual(mockSocket!.sentMessages[1]?.content?.image, { url: 'https://disparflux.test/banner.png' });

      // 3. Send text message with 2 arguments and { text: '...' } content
      const twoArgResult = await connector.sendMessage('conn-1', {
        to: '5511998765432@s.whatsapp.net',
        content: { text: 'Mensagem com formato de dois argumentos' },
      });

      assert.equal(twoArgResult.status, 'sent');
      assert.equal(mockSocket!.sentMessages.length, 3);
      assert.deepEqual(mockSocket!.sentMessages[2]?.content, { text: 'Mensagem com formato de dois argumentos' });

      // 4. Test onWhatsApp validation
      const waResults = await connector.onWhatsApp('conn-1', '5511998887777', '551100000000_invalid');
      assert.equal(waResults.length, 2);
      assert.equal(waResults[0]?.exists, true);
      assert.equal(waResults[1]?.exists, false);
    });
  });

  describe('Inbound Message Processing & LID Reconciliation', () => {
    it('emits message events and reconciles LID mappings learned from contacts', async () => {
      let mockSocket: MockWASocket | null = null;
      const receivedMessages: InboundMessage[] = [];

      connector.on('message', (msg) => receivedMessages.push(msg));

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      mockSocket!.ev.emit('connection.update', { connection: 'open' });

      // Register contact linking LID to JID
      const lid = '9876543210@lid';
      const jid = '5511998765432@s.whatsapp.net';
      mockSocket!.ev.emit('contacts.upsert', [{ id: jid, lid }]);

      // Inbound message arrives with LID
      mockSocket!.ev.emit('messages.upsert', {
        messages: [
          {
            key: {
              id: 'inbound-lid-msg-1',
              remoteJid: lid,
              fromMe: false,
            },
            message: {
              conversation: 'Olá quero mais informações',
            },
            messageTimestamp: 1700000000,
          },
        ],
      });

      assert.equal(receivedMessages.length, 1);
      assert.equal(receivedMessages[0]?.messageId, 'inbound-lid-msg-1');
      assert.equal(receivedMessages[0]?.from, '5511998765432', 'Should resolve canonical phone from contact LID mapping');
      assert.equal(receivedMessages[0]?.content, 'Olá quero mais informações');
    });
  });

  describe('Connection Lifecycle & Disconnect Reasons', () => {
    it('handles permanent loggedOut (401) without reconnecting', async () => {
      let mockSocket: MockWASocket | null = null;
      const statusUpdates: StatusEventPayload[] = [];

      connector.on('status', (s) => statusUpdates.push(s));

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      // Simulate loggedOut
      mockSocket!.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: {
            output: { statusCode: DisconnectReason.loggedOut },
          },
        },
      });

      assert.equal(connector.getStatus('conn-1'), 'disconnected');
      assert.ok(statusUpdates.some((s) => s.status === 'disconnected' && s.disconnectReason === 'loggedOut'));
    });

    it('triggers exponential backoff retry on temporary network disconnect', async () => {
      let mockSocket: MockWASocket | null = null;
      let spawnCount = 0;
      const statusUpdates: StatusEventPayload[] = [];

      connector.on('status', (s) => statusUpdates.push(s));

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        maxRetries: 3,
        initialRetryDelayMs: 20, // fast retry for unit test
        maxRetryDelayMs: 50,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          spawnCount++;
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      assert.equal(spawnCount, 1);

      // Simulate network timeout
      mockSocket!.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: {
            output: { statusCode: DisconnectReason.timedOut },
          },
        },
      });

      assert.equal(connector.getStatus('conn-1'), 'connecting');
      assert.ok(statusUpdates.some((s) => s.disconnectReason === 'reconnecting_attempt_1'));

      // Wait for the 20ms timer to fire
      await new Promise((r) => setTimeout(r, 40));

      // Reconnection should have spawned socket 2
      assert.equal(spawnCount, 2);
    });

    it('transitions to failed when max retries are exceeded', async () => {
      let mockSocket: MockWASocket | null = null;
      const statusUpdates: StatusEventPayload[] = [];

      connector.on('status', (s) => statusUpdates.push(s));

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        maxRetries: 1,
        initialRetryDelayMs: 5,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      // 1st disconnect -> reconnecting_attempt_1
      mockSocket!.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: DisconnectReason.connectionLost } },
        },
      });

      // Wait for retry
      await new Promise((r) => setTimeout(r, 20));

      // 2nd disconnect -> retries exceeded -> failed
      mockSocket!.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: DisconnectReason.connectionLost } },
        },
      });

      assert.equal(connector.getStatus('conn-1'), 'failed');
      assert.ok(statusUpdates.some((s) => s.status === 'failed' && s.disconnectReason === 'maxRetriesExceeded'));
    });

    it('gracefully shuts down when disconnect() is called manually', async () => {
      let mockSocket: MockWASocket | null = null;

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      assert.equal(mockSocket!.closed, false);

      await connector.disconnect('conn-1');

      assert.equal(mockSocket!.closed, true);
      assert.equal(connector.getStatus('conn-1'), 'disconnected');
    });
  });

  describe('History Synchronization & Status Updates (ADR 0002, 0015)', () => {
    it('captures messaging-history.set and emits structured history event with chats, contacts, and messages', async () => {
      let mockSocket: MockWASocket | null = null;
      let historyEvent: HistorySyncPayload | null = null;

      connector.on('history', (payload) => {
        historyEvent = payload;
      });

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      mockSocket!.ev.emit('connection.update', { connection: 'open' });

      // Emit messaging-history.set
      mockSocket!.ev.emit('messaging-history.set', {
        chats: [
          { id: '5511999990001@s.whatsapp.net', name: 'Cliente A', conversationTimestamp: 1700000000, unreadCount: 2 },
        ],
        contacts: [
          { id: '5511999990001@s.whatsapp.net', name: 'Cliente A', notify: 'A' },
        ],
        messages: [
          {
            key: { id: 'msg-hist-1', remoteJid: '5511999990001@s.whatsapp.net', fromMe: false },
            message: { conversation: 'Olá, tudo bem?' },
            messageTimestamp: 1699999000,
          },
          {
            key: { id: 'msg-hist-2', remoteJid: '5511999990001@s.whatsapp.net', fromMe: true },
            message: { conversation: 'Tudo bem! Como posso ajudar?' },
            messageTimestamp: 1699999500,
          },
        ],
        lidPnMappings: [
          { lid: '123456@lid', pn: '5511999990001@s.whatsapp.net' },
        ],
        isLatest: true,
        progress: 100,
      });

      assert.notEqual(historyEvent, null);
      assert.equal(historyEvent?.connectionId, 'conn-1');
      assert.equal(historyEvent?.chats.length, 1);
      assert.equal(historyEvent?.chats[0]?.name, 'Cliente A');
      assert.equal(historyEvent?.contacts.length, 1);
      assert.equal(historyEvent?.messages.length, 2);
      assert.equal(historyEvent?.messages[0]?.direction, 'inbound');
      assert.equal(historyEvent?.messages[1]?.direction, 'outbound');
      assert.equal(historyEvent?.messages[1]?.fromMe, true);
      assert.equal(historyEvent?.isLatest, true);
    });

    it('captures messages.update and emits message:status events', async () => {
      let mockSocket: MockWASocket | null = null;
      const statusUpdates: MessageStatusUpdatePayload[] = [];

      connector.on('message:status', (payload) => {
        statusUpdates.push(payload);
      });

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      mockSocket!.ev.emit('connection.update', { connection: 'open' });

      // Emit messages.update for delivery ack (status 3) and read ack (status 4)
      mockSocket!.ev.emit('messages.update', [
        {
          key: { id: 'msg-123', remoteJid: '5511999990001@s.whatsapp.net' },
          update: { status: 3 },
        },
        {
          key: { id: 'msg-456', remoteJid: '5511999990001@s.whatsapp.net' },
          update: { status: 4 },
        },
      ]);

      assert.equal(statusUpdates.length, 2);
      assert.equal(statusUpdates[0]?.messageId, 'msg-123');
      assert.equal(statusUpdates[0]?.status, 'delivered');
      assert.equal(statusUpdates[1]?.messageId, 'msg-456');
      assert.equal(statusUpdates[1]?.status, 'read');
    });

    it('fetchOlderMessages delegates to sock.fetchMessageHistory with timestamp in milliseconds', async () => {
      let mockSocket: MockWASocket | null = null;

      await connector.connect('conn-1', {
        dataDir: tempBaseDir,
        authStateFactory: async () => ({
          state: { creds: {}, keys: {} } as any,
          saveCreds: async () => {},
        }),
        socketFactory: () => {
          mockSocket = new MockWASocket();
          return mockSocket;
        },
      });

      mockSocket!.ev.emit('connection.update', { connection: 'open' });

      const timestampMs = 1700000000000;
      const result = await connector.fetchOlderMessages(
        'conn-1',
        '5511999990001@s.whatsapp.net',
        50,
        {
          id: 'msg-anchor-1',
          fromMe: false,
          timestampMs,
        }
      );

      assert.ok(result.requestId);
      assert.equal(result.count, 50);
      assert.equal(mockSocket!.historyRequests.length, 1);
      assert.equal(mockSocket!.historyRequests[0]?.tsMs, timestampMs);
      assert.equal(mockSocket!.historyRequests[0]?.oldestKey.id, 'msg-anchor-1');
    });
  });
});
