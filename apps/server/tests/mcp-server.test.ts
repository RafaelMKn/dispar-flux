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

describe('MCP Server (Block C / Issue #9 / Model Context Protocol)', () => {
  let tempDir: string;
  let server: DisparFluxServer;
  let ownerToken: string;
  let orgId: string;
  let testContactId: string;
  let testLeadId: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-mcp-srv-'));
    server = new DisparFluxServer(
      {
        port: 0,
        host: '127.0.0.1',
        dataDir: tempDir,
        nodeEnv: 'test',
        version: '1.0.0',
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
        organizationName: 'MCP Test Organization',
        ownerName: 'Alice MCP',
        ownerEmail: 'alice@mcp.test',
        password: 'Password123!',
      }),
    });
    assert.equal(claimRes.status, 201);
    const claimData = (await claimRes.json()) as any;
    ownerToken = claimData.token;
    orgId = claimData.organizationId;

    // 2. Pre-seed DB with connection, contact, funnel, lead
    const db = (server as any).db;
    const now = new Date().toISOString();
    testContactId = `cnt_${crypto.randomUUID()}`;
    testLeadId = `lead_${crypto.randomUUID()}`;

    db.prepare(`
      INSERT INTO messaging_connections (id, organization_id, name, provider, status, phone_number, is_default, created_at, updated_at)
      VALUES ('conn_mcp_1', ?, 'Main WhatsApp', 'baileys', 'connected', '+5511999990001', 1, ?, ?)
    `).run(orgId, now, now);

    db.prepare(`
      INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
      VALUES (?, ?, '+5511988887777', 'Carlos Test', '{"cargo":"Diretor"}', 0, ?, ?)
    `).run(testContactId, orgId, now, now);

    db.prepare(`
      INSERT INTO funnels (id, organization_id, name, stages, created_at, updated_at)
      VALUES ('funnel_mcp_1', ?, 'Pipeline Comercial', '[{"id":"stage_initial","name":"Primeiro Contato"},{"id":"stage_qualified","name":"Qualificado"}]', ?, ?)
    `).run(orgId, now, now);

    db.prepare(`
      INSERT INTO leads (id, organization_id, funnel_id, contact_id, stage_id, value, notes, created_at, updated_at)
      VALUES (?, ?, 'funnel_mcp_1', ?, 'stage_initial', 15000, 'Interesse no produto.', ?, ?)
    `).run(testLeadId, orgId, testContactId, now, now);
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Direct JSON-RPC Handling (POST /api/v1/mcp/rpc)', () => {
    it('handles initialize handshake method', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { clientInfo: { name: 'test-client', version: '1.0' } },
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.jsonrpc, '2.0');
      assert.equal(data.id, 1);
      assert.equal(data.result.protocolVersion, '2024-11-05');
      assert.equal(data.result.serverInfo.name, 'dispar-flux-mcp');
    });

    it('handles ping method', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'ping',
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.jsonrpc, '2.0');
      assert.equal(data.id, 2);
      assert.deepEqual(data.result, {});
    });

    it('handles tools/list method and returns all 6 registered tools', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/list',
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.ok(data.result?.tools);
      const toolNames = data.result.tools.map((t: any) => t.name);
      assert.ok(toolNames.includes('df_list_funnel_leads'));
      assert.ok(toolNames.includes('df_get_lead_details'));
      assert.ok(toolNames.includes('df_move_lead_stage'));
      assert.ok(toolNames.includes('df_send_manual_message'));
      assert.ok(toolNames.includes('df_register_opt_out'));
      assert.ok(toolNames.includes('df_get_campaign_health'));
    });

    it('tools/call -> df_list_funnel_leads returns list of leads', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'df_list_funnel_leads',
            arguments: {
              funnelId: 'funnel_mcp_1',
            },
          },
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.result?.isError, false);
      const parsed = JSON.parse(data.result.content[0].text);
      assert.ok(parsed.count >= 1);
      assert.equal(parsed.leads[0].lead_id, testLeadId);
    });

    it('tools/call -> df_get_lead_details returns lead and contact details', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'df_get_lead_details',
            arguments: {
              leadId: testLeadId,
            },
          },
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.result?.isError, false);
      const parsed = JSON.parse(data.result.content[0].text);
      assert.equal(parsed.lead.id, testLeadId);
      assert.equal(parsed.contact.phone, '+5511988887777');
    });

    it('tools/call -> df_move_lead_stage updates stage, records audit log', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'df_move_lead_stage',
            arguments: {
              leadId: testLeadId,
              targetStageId: 'stage_qualified',
              internalNote: 'Cliente qualificado pelo assistente IA.',
            },
          },
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.result?.isError, false);
      const parsed = JSON.parse(data.result.content[0].text);
      assert.equal(parsed.success, true);
      assert.equal(parsed.targetStageId, 'stage_qualified');

      // Verify DB update
      const db = (server as any).db;
      const leadRow = db.prepare('SELECT stage_id, notes FROM leads WHERE id = ?').get(testLeadId) as any;
      assert.equal(leadRow.stage_id, 'stage_qualified');
      assert.match(leadRow.notes, /Cliente qualificado pelo assistente IA/);

      // Verify audit log
      const audit = db.prepare('SELECT * FROM audit_logs WHERE target_id = ? AND action = ?').get(testLeadId, 'lead:stage_changed') as any;
      assert.ok(audit);
    });

    it('tools/call -> df_send_manual_message records manual message', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: {
            name: 'df_send_manual_message',
            arguments: {
              phone: '+5511988887777',
              text: 'Olá! Enviando resposta via ferramenta MCP.',
            },
          },
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.result?.isError, false);
      const parsed = JSON.parse(data.result.content[0].text);
      assert.equal(parsed.success, true);
      assert.ok(parsed.messageId);
      assert.equal(parsed.phone, '+5511988887777');
    });

    it('tools/call -> df_register_opt_out registers opt-out', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 8,
          method: 'tools/call',
          params: {
            name: 'df_register_opt_out',
            arguments: {
              phone: '+5511988887777',
              reason: 'Solicitado via comando de IA',
            },
          },
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.result?.isError, false);
      const parsed = JSON.parse(data.result.content[0].text);
      assert.equal(parsed.success, true);
      assert.equal(parsed.phone, '+5511988887777');

      // Verify contact marked as opted out in DB
      const db = (server as any).db;
      const contact = db.prepare('SELECT is_opted_out FROM contacts WHERE id = ?').get(testContactId) as any;
      assert.equal(contact.is_opted_out, 1);
    });

    it('tools/call -> df_get_campaign_health returns overview of messaging infrastructure', async () => {
      const res = await fetch(`${server.url}/api/v1/mcp/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 9,
          method: 'tools/call',
          params: {
            name: 'df_get_campaign_health',
            arguments: {},
          },
        }),
      });

      assert.equal(res.status, 200);
      const data = (await res.json()) as any;
      assert.equal(data.result?.isError, false);
      const parsed = JSON.parse(data.result.content[0].text);
      assert.equal(parsed.success, true);
      assert.ok(Array.isArray(parsed.connections));
      assert.ok(parsed.connections.some((c: any) => c.id === 'conn_mcp_1'));
    });
  });

  describe('MCP SSE Transport Handshake (/api/v1/mcp/sse and /api/v1/mcp/messages)', () => {
    it('initializes SSE session and returns endpoint location', async () => {
      const controller = new AbortController();
      const sseRes = await fetch(`${server.url}/api/v1/mcp/sse`, {
        headers: {
          Authorization: `Bearer ${ownerToken}`,
        },
        signal: controller.signal,
      });

      assert.equal(sseRes.status, 200);
      assert.equal(sseRes.headers.get('content-type'), 'text/event-stream');

      // Read initial chunk
      const reader = sseRes.body?.getReader();
      assert.ok(reader);
      const { value } = await reader.read();
      const chunk = new TextDecoder().decode(value);
      assert.match(chunk, /event: endpoint/);
      assert.match(chunk, /data: \/api\/v1\/mcp\/messages\?sessionId=/);

      const match = chunk.match(/sessionId=([a-zA-Z0-9-]+)/);
      assert.ok(match);
      const sessionId = match[1];

      // Send RPC message through the message endpoint
      const msgRes = await fetch(`${server.url}/api/v1/mcp/messages?sessionId=${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'ping',
        }),
      });
      assert.equal(msgRes.status, 202);

      // Read SSE stream response
      const { value: respValue } = await reader.read();
      const respChunk = new TextDecoder().decode(respValue);
      assert.match(respChunk, /event: message/);
      assert.match(respChunk, /"jsonrpc":"2.0"/);
      assert.match(respChunk, /"id":99/);

      controller.abort();
    });
  });
});
