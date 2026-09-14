import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { readClaimToken } from '@dispar-flux/auth';
import { DisparFluxServer } from '../src/server.js';
import { Logger } from '../src/logger.js';

const silentLogger = new Logger({
  level: 'error',
  output: () => {},
});

describe('Inbox Copilot HTTP API Routes (Block A)', () => {
  let tempDir: string;
  let server: DisparFluxServer;
  let ownerToken: string;
  let orgId: string;
  const testJid = '5511999998888@s.whatsapp.net';

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-copilot-srv-'));
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
        organizationName: 'Org Copilot Test',
        ownerName: 'Alice Owner',
        ownerEmail: 'alice@copilot.corp',
        password: 'Password123!',
      }),
    });
    assert.equal(claimRes.status, 201);
    const claimData = (await claimRes.json()) as any;
    ownerToken = claimData.token;
    orgId = claimData.organizationId;

    // 2. Pre-seed a connection, contact and conversation with messages in DB
    const db = (server as any).db;
    const now = new Date().toISOString();
    const contactId = 'cnt_copilot_1';

    db.prepare(`
      INSERT INTO messaging_connections (id, organization_id, name, provider, status, phone_number, created_at, updated_at)
      VALUES ('conn_1', ?, 'WhatsApp Test', 'baileys', 'connected', '5511999990001', ?, ?)
    `).run(orgId, now, now);

    db.prepare(`
      INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
      VALUES (?, ?, '5511999998888', 'Marina Silva', '{"empresa":"TechCorp"}', 0, ?, ?)
    `).run(contactId, orgId, now, now);

    const convId = 'conv_copilot_1';
    db.prepare(`
      INSERT INTO conversations (id, organization_id, connection_id, contact_id, unread_count, last_message_at, created_at, updated_at)
      VALUES (?, ?, 'conn_1', ?, 1, ?, ?, ?)
    `).run(convId, orgId, contactId, now, now, now);

    db.prepare(`
      INSERT INTO messages (id, conversation_id, direction, type, kind, content, status, created_at)
      VALUES (?, ?, 'inbound', 'manual', 'inbound', 'Olá! Gostaria de uma cotação para o plano empresarial.', 'delivered', ?)
    `).run(crypto.randomUUID(), convId, now);

    // Pre-seed funnel and lead
    db.prepare(`
      INSERT INTO funnels (id, organization_id, name, stages, created_at, updated_at)
      VALUES ('funnel_copilot_1', ?, 'Vendas', '[{"id":"st_1","name":"Interessados"}]', ?, ?)
    `).run(orgId, now, now);

    db.prepare(`
      INSERT INTO leads (id, organization_id, funnel_id, contact_id, stage_id, notes, created_at, updated_at)
      VALUES ('lead_copilot_1', ?, 'funnel_copilot_1', ?, 'st_1', 'Contato via campanha.', ?, ?)
    `).run(orgId, contactId, now, now);
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('rejects unauthenticated requests to copilot endpoints with 401', async () => {
    const encodedJid = encodeURIComponent(testJid);
    const suggestRes = await fetch(`${server.url}/api/v1/inbox/chats/${encodedJid}/ai/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tone: 'formal' }),
    });
    assert.equal(suggestRes.status, 401);

    const summarizeRes = await fetch(`${server.url}/api/v1/inbox/chats/${encodedJid}/ai/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveAsLeadNote: true }),
    });
    assert.equal(summarizeRes.status, 401);
  });

  it('POST /api/v1/inbox/chats/:jid/ai/suggest returns 200 with suggestion and contextTokensUsed', async () => {
    const encodedJid = encodeURIComponent(testJid);
    const res = await fetch(`${server.url}/api/v1/inbox/chats/${encodedJid}/ai/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        tone: 'formal',
        instruction: 'Informar que enviaremos a proposta por email',
      }),
    });

    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.ok(data.suggestion);
    assert.ok(data.suggestion.includes('Marina'));
    assert.ok(data.suggestion.includes('proposta por email'));
    assert.equal(typeof data.contextTokensUsed, 'number');
    assert.ok(data.contextTokensUsed > 0);
  });

  it('POST /api/v1/inbox/chats/:jid/ai/summarize returns 200 and updates lead note when requested', async () => {
    const encodedJid = encodeURIComponent(testJid);
    const res = await fetch(`${server.url}/api/v1/inbox/chats/${encodedJid}/ai/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        saveAsLeadNote: true,
      }),
    });

    assert.equal(res.status, 200);
    const data = (await res.json()) as any;
    assert.ok(data.summary);
    assert.ok(Array.isArray(data.keyPoints));
    assert.ok(Array.isArray(data.nextSteps));

    // Check that lead notes were updated in the DB
    const db = (server as any).db;
    const leadRow = db.prepare('SELECT notes FROM leads WHERE id = ?').get('lead_copilot_1') as { notes: string };
    assert.ok(leadRow.notes.includes('Contato via campanha.'));
    assert.ok(leadRow.notes.includes('Resumo'));
    assert.ok(leadRow.notes.includes(data.summary));
  });

  it('allows operators with INBOX_REPLY_MANUAL to access both endpoints', async () => {
    // Register operator
    const db = (server as any).db;
    const now = new Date().toISOString();
    const opMember = (server as any).memberService.createMember({
      organizationId: orgId,
      name: 'Operador Teste',
      email: 'operador@copilot.corp',
      role: 'operator',
      password: 'PasswordOp123!',
    });

    const dev = (server as any).deviceService.registerOrGetDevice({
      memberId: opMember.id,
      deviceFingerprint: 'op-dev-fp-1',
      name: 'Op Laptop',
      userAgent: 'NodeTest',
      ipAddress: '127.0.0.1',
    });
    const ownerMember = (server as any).memberService.listMembers(orgId).find((m: any) => m.role === 'owner');
    (server as any).deviceService.approveDevice({
      deviceId: dev.device.id,
      organizationId: orgId,
      actorRole: 'owner',
      approvedByMemberId: ownerMember.id,
    });

    const { rawToken: opToken } = (server as any).sessionService.createSession(opMember.id, dev.device.id);

    const encodedJid = encodeURIComponent(testJid);
    const resSuggest = await fetch(`${server.url}/api/v1/inbox/chats/${encodedJid}/ai/suggest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opToken}`,
      },
      body: JSON.stringify({ tone: 'direct' }),
    });
    assert.equal(resSuggest.status, 200);

    const resSummarize = await fetch(`${server.url}/api/v1/inbox/chats/${encodedJid}/ai/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opToken}`,
      },
      body: JSON.stringify({ saveAsLeadNote: false }),
    });
    assert.equal(resSummarize.status, 200);
  });
});
