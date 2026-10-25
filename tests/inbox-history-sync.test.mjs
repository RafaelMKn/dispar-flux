import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createServer } from '../apps/server/dist/server.js';
import { readClaimToken } from '../packages/auth/dist/onboarding/claim-token.js';

function makeTempDir(prefix = 'dispar-history-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}

async function claimServer(server, address, dataDir, name = 'Test User') {
  const claimCode = readClaimToken(dataDir);
  const claimRes = await fetch(`${address}/api/v1/auth/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      claimCode,
      organizationName: 'Dispar Flux Test Org',
      ownerName: name,
      ownerEmail: 'owner@disparfluxtest.local',
      password: 'SuperSecurePassword123!',
      operationalTimezone: 'America/Sao_Paulo',
    }),
  });
  assert.equal(claimRes.status, 201);
  return await claimRes.json();
}

describe('Inbox WhatsApp History Sync & Outbound Message Handling (Issue #12)', { concurrency: 1 }, () => {
  it('ingests messaging-history.set, supports outbound messages, calculates dynamic lastMessage, and manages sync state', async () => {
    const dataDir = makeTempDir('inbox-hist-test-');
    const server = createServer({ dataDir, port: 0 });
    const { address } = await server.start();

    try {
      const claim = await claimServer(server, address, dataDir, 'Inbox Operator');
      const headers = {
        'Authorization': `Bearer ${claim.token}`,
        'Content-Type': 'application/json',
      };

      // 1. Initial sync-state query returns idle
      const syncStateRes = await fetch(`${address}/api/v1/inbox/sync-state`, { headers });
      assert.equal(syncStateRes.status, 200);
      const syncStateData = await syncStateRes.json();
      assert.equal(syncStateData.state, 'idle');

      // 2. Simulate Baileys emitting a messaging-history.set event
      server.baileysConnector.emit('history', {
        connectionId: 'conn_default',
        chats: [
          {
            id: '5511999991111@s.whatsapp.net',
            name: 'Ana Silva',
            conversationTimestamp: 1700001000,
            unreadCount: 1,
          },
          {
            id: '5511988882222@s.whatsapp.net',
            name: 'Carlos Oliveira',
            conversationTimestamp: 1700002000,
            unreadCount: 0,
          },
        ],
        contacts: [
          { id: '5511999991111@s.whatsapp.net', name: 'Ana Silva', notify: 'Ana' },
          { id: '5511988882222@s.whatsapp.net', name: 'Carlos Oliveira', notify: 'Carlos' },
        ],
        messages: [
          {
            messageId: 'msg-hist-in-1',
            connectionId: 'conn_default',
            from: '+5511999991111',
            remoteJid: '5511999991111@s.whatsapp.net',
            content: 'Olá! Gostaria de saber mais sobre o produto.',
            type: 'text',
            timestamp: new Date('2026-09-20T10:00:00Z'),
            direction: 'inbound',
            fromMe: false,
          },
          {
            messageId: 'msg-hist-out-1',
            connectionId: 'conn_default',
            from: '+5511999991111',
            remoteJid: '5511999991111@s.whatsapp.net',
            content: 'Perfeito! Enviando nossa apresentação.',
            type: 'text',
            timestamp: new Date('2026-09-20T10:05:00Z'),
            direction: 'outbound',
            fromMe: true,
          },
          {
            messageId: 'msg-hist-in-2',
            connectionId: 'conn_default',
            from: '+5511988882222',
            remoteJid: '5511988882222@s.whatsapp.net',
            content: 'Confirmando a reunião de amanhã.',
            type: 'text',
            timestamp: new Date('2026-09-21T14:30:00Z'),
            direction: 'inbound',
            fromMe: false,
          },
        ],
        lidPnMappings: [
          { lid: '123456@lid', pn: '5511999991111@s.whatsapp.net' },
        ],
        isLatest: true,
        progress: 100,
      });

      // 3. Verify GET /api/v1/inbox/chats returns dynamic lastMessage (NOT "Olá, como posso ajudar?")
      const chatsRes = await fetch(`${address}/api/v1/inbox/chats`, { headers });
      assert.equal(chatsRes.status, 200);
      const chats = await chatsRes.json();
      assert.equal(chats.length, 2);

      const anaChat = chats.find((c) => c.jid === '5511999991111@s.whatsapp.net');
      assert.ok(anaChat, 'Ana Silva chat must exist in inbox list');
      assert.equal(anaChat.name, 'Ana Silva');
      // Last message in Ana's chat was the outbound reply
      assert.equal(anaChat.lastMessage, 'Perfeito! Enviando nossa apresentação.');
      assert.notEqual(anaChat.lastMessage, 'Olá, como posso ajudar?');

      const carlosChat = chats.find((c) => c.jid === '5511988882222@s.whatsapp.net');
      assert.ok(carlosChat, 'Carlos chat must exist');
      assert.equal(carlosChat.lastMessage, 'Confirmando a reunião de amanhã.');

      // 4. Verify GET /api/v1/inbox/chats/:jid/messages returns both inbound and outbound messages
      const anaMessagesRes = await fetch(`${address}/api/v1/inbox/chats/5511999991111%40s.whatsapp.net/messages`, { headers });
      assert.equal(anaMessagesRes.status, 200);
      const anaMessages = await anaMessagesRes.json();
      assert.equal(anaMessages.length, 2);
      assert.equal(anaMessages[0].direction, 'in');
      assert.equal(anaMessages[0].body, 'Olá! Gostaria de saber mais sobre o produto.');
      assert.equal(anaMessages[1].direction, 'out');
      assert.equal(anaMessages[1].body, 'Perfeito! Enviando nossa apresentação.');

      // 5. Verify GET /api/v1/inbox/chats/:jid single chat endpoint
      const anaDetailRes = await fetch(`${address}/api/v1/inbox/chats/5511999991111%40s.whatsapp.net`, { headers });
      assert.equal(anaDetailRes.status, 200);
      const anaDetail = await anaDetailRes.json();
      assert.equal(anaDetail.jid, '5511999991111@s.whatsapp.net');
      assert.equal(anaDetail.name, 'Ana Silva');
      assert.equal(anaDetail.lastMessage, 'Perfeito! Enviando nossa apresentação.');

      // 6. Verify GET /api/v1/inbox/chats/:jid/count
      const anaCountRes = await fetch(`${address}/api/v1/inbox/chats/5511999991111%40s.whatsapp.net/count`, { headers });
      assert.equal(anaCountRes.status, 200);
      const anaCount = await anaCountRes.json();
      assert.equal(anaCount, 2);

      // 7. Verify search filter (?search=Carlos)
      const searchRes = await fetch(`${address}/api/v1/inbox/chats?search=Carlos`, { headers });
      assert.equal(searchRes.status, 200);
      const searchChats = await searchRes.json();
      assert.equal(searchChats.length, 1);
      assert.equal(searchChats[0].name, 'Carlos Oliveira');

      // 8. Verify POST /api/v1/inbox/chats/:jid/read marks unread as 0
      const readRes = await fetch(`${address}/api/v1/inbox/chats/5511999991111%40s.whatsapp.net/read`, {
        method: 'POST',
        headers,
      });
      assert.equal(readRes.status, 200);

      const anaAfterReadRes = await fetch(`${address}/api/v1/inbox/chats/5511999991111%40s.whatsapp.net`, { headers });
      const anaAfterRead = await anaAfterReadRes.json();
      assert.equal(anaAfterRead.unreadCount, 0);

      // 9. Verify message status update via message:status event
      server.baileysConnector.emit('message:status', {
        connectionId: 'conn_default',
        messageId: 'msg-hist-out-1',
        remoteJid: '5511999991111@s.whatsapp.net',
        status: 'read',
      });

      const updatedMsgsRes = await fetch(`${address}/api/v1/inbox/chats/5511999991111%40s.whatsapp.net/messages`, { headers });
      const updatedMsgs = await updatedMsgsRes.json();
      const updatedOutbound = updatedMsgs.find((m) => m.id === anaMessages[1].id);
      assert.equal(updatedOutbound.status, 'read');
    } finally {
      await server.stop();
      cleanDir(dataDir);
    }
  });
});
