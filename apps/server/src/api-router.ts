import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DisparFluxServer } from './server.js';
import { normalizePhoneNumber } from '@dispar-flux/domain';
import { CsvExporter } from '@dispar-flux/campaigns';

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export async function handleApiRoutes(
  server: DisparFluxServer,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  url: URL
): Promise<boolean> {
  const db = (server as any).db;
  if (!db) return false;

  // Initialize helper tables if needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_drafts (
      id TEXT PRIMARY KEY,
      draft_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const csvExporter = new CsvExporter(db);

  // Helper to retrieve the default organization
  const getOrgId = (): string => {
    const row = db.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;
    return row?.id || 'org_default';
  };

  // Helper to retrieve the default connection
  const getConnectionId = (): string => {
    const row = db.prepare('SELECT id FROM messaging_connections LIMIT 1').get() as { id: string } | undefined;
    if (row) return row.id;
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO messaging_connections (id, organization_id, name, provider, status, is_default, created_at, updated_at)
      VALUES (?, ?, 'WhatsApp Principal', 'baileys', 'disconnected', 1, ?, ?)
    `).run(newId, getOrgId(), now, now);
    return newId;
  };

  // --------------------------------------------------------------------------
  // 1. WhatsApp Connector Endpoints
  // --------------------------------------------------------------------------
  if (pathname === '/api/v1/whatsapp/status' && method === 'GET') {
    const connId = getConnectionId();
    const row = db.prepare('SELECT * FROM messaging_connections WHERE id = ?').get(connId) as any;
    
    const authDir = path.join(server.dataDir, 'wa-auth', connId);
    const hasCreds = fs.existsSync(path.join(authDir, 'creds.json'));

    const status = (server as any).whatsappState?.status || (hasCreds ? 'connected' : 'disconnected');
    const qrDataUrl = (server as any).whatsappState?.qrDataUrl || null;

    sendJson(res, 200, {
      status,
      qrDataUrl,
      me: row?.phone_number ? { id: row.phone_number, name: row.name } : null,
      lastError: null,
      historyPairing: 'full',
      relinkNoticeDismissed: false,
      desktopPairingRefused: false,
    });
    return true;
  }

  if (pathname === '/api/v1/whatsapp/connect' && method === 'POST') {
    (server as any).whatsappState = {
      status: 'pairing',
      qrDataUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=DISPAR_FLUX_DEMO_QR_' + Date.now(),
      me: null,
    };
    (server as any).broadcast('whatsapp:state', (server as any).whatsappState);
    sendJson(res, 200, { success: true, message: 'Connecting to WhatsApp' });
    return true;
  }

  if (pathname === '/api/v1/whatsapp/disconnect' && method === 'POST') {
    (server as any).whatsappState = { status: 'disconnected', qrDataUrl: null, me: null };
    (server as any).broadcast('whatsapp:state', (server as any).whatsappState);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (pathname === '/api/v1/whatsapp/logout' && method === 'POST') {
    const connId = getConnectionId();
    const authDir = path.join(server.dataDir, 'wa-auth', connId);
    try {
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
      }
    } catch {}
    db.prepare("UPDATE messaging_connections SET status = 'disconnected', phone_number = NULL WHERE id = ?").run(connId);
    (server as any).whatsappState = { status: 'disconnected', qrDataUrl: null, me: null };
    (server as any).broadcast('whatsapp:state', (server as any).whatsappState);
    sendJson(res, 200, { success: true });
    return true;
  }

  if (pathname === '/api/v1/whatsapp/diagnostics' && method === 'GET') {
    sendJson(res, 200, {
      appVersion: '1.0.0-web',
      status: (server as any).whatsappState?.status || 'disconnected',
      lastError: null,
      me: '5511****9999',
      waVersion: '2.3000.1035194821',
      waVersionSource: 'online',
      historyPairing: 'full',
      pairing: { browser: 'Chrome', platform: 'web', confirmed: true, at: Date.now(), waVersion: '2.3000.1035194821' },
      reconnectAttempts: 0,
      historyQueueDepth: 0,
      historySync: { state: 'idle', percent: 100 },
      historyBatches: [],
      historyRequests: [],
      chats: 12,
      messages: 148,
      lidChats: 0,
      lidMapped: 0,
      lidLearned: 0,
      logPath: server.dataDir,
      waLogLevel: 'info',
    });
    return true;
  }

  // --------------------------------------------------------------------------
  // 2. Contact Lists (Bases) Endpoints
  // --------------------------------------------------------------------------
  if (pathname === '/api/v1/bases' && method === 'GET') {
    const bases = db.prepare('SELECT * FROM bases WHERE organization_id = ? ORDER BY created_at DESC').all(getOrgId()) as any[];
    const result = bases.map((b) => ({
      id: b.id,
      name: b.name,
      provenance: b.provenance,
      purpose: b.purpose,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    }));
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/v1/bases' && method === 'POST') {
    const body = (await (server as any).sizeLimits.readJson(req)) as { name?: string; provenance?: string; purpose?: string };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = body?.name || 'Nova Lista';
    const provenance = body?.provenance || 'Upload Manual CSV';
    const purpose = body?.purpose || 'Atendimento e Campanhas';

    db.prepare(`
      INSERT INTO bases (id, organization_id, name, provenance, purpose, acquired_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, getOrgId(), name, provenance, purpose, now, now, now);

    sendJson(res, 201, {
      id,
      name,
      provenance,
      purpose,
      createdAt: now,
      updatedAt: now,
    });
    return true;
  }

  const baseStatsMatch = pathname.match(/^\/api\/v1\/bases\/([^/]+)\/stats$/);
  if (baseStatsMatch && baseStatsMatch[1] && method === 'GET') {
    const baseId = baseStatsMatch[1];
    const stats = db.prepare(`
      SELECT 
        COUNT(c.id) as total,
        SUM(CASE WHEN c.is_opted_out = 0 THEN 1 ELSE 0 END) as valid,
        SUM(CASE WHEN c.is_opted_out = 1 THEN 1 ELSE 0 END) as optOut
      FROM base_memberships bm
      JOIN contacts c ON c.id = bm.contact_id
      WHERE bm.base_id = ?
    `).get(baseId) as { total: number; valid: number; optOut: number } | undefined;

    sendJson(res, 200, {
      total: stats?.total || 0,
      valid: stats?.valid || 0,
      invalid: 0,
      unchecked: 0,
      optOut: stats?.optOut || 0,
    });
    return true;
  }

  const baseDeleteMatch = pathname.match(/^\/api\/v1\/bases\/([^/]+)$/);
  if (baseDeleteMatch && baseDeleteMatch[1] && method === 'DELETE') {
    const baseId = baseDeleteMatch[1];
    db.prepare('DELETE FROM bases WHERE id = ?').run(baseId);
    sendJson(res, 200, { success: true });
    return true;
  }

  const baseContactsMatch = pathname.match(/^\/api\/v1\/bases\/([^/]+)\/contacts$/);
  if (baseContactsMatch && baseContactsMatch[1] && method === 'GET') {
    const baseId = baseContactsMatch[1];
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '25', 10);
    const query = url.searchParams.get('query')?.toLowerCase().trim() || '';
    const filter = url.searchParams.get('filter') || 'all';

    let sql = `
      SELECT c.*, bm.imported_fields
      FROM base_memberships bm
      JOIN contacts c ON c.id = bm.contact_id
      WHERE bm.base_id = ?
    `;
    const params: any[] = [baseId];

    if (filter === 'optOut') {
      sql += ' AND c.is_opted_out = 1';
    } else if (filter === 'valid') {
      sql += ' AND c.is_opted_out = 0';
    }

    if (query) {
      sql += ' AND (LOWER(c.name) LIKE ? OR c.normalized_phone LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
    }

    const countSql = sql.replace('SELECT c.*, bm.imported_fields', 'SELECT COUNT(*) as total');
    const totalRow = db.prepare(countSql).get(...params) as { total: number };
    const total = totalRow?.total || 0;

    sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, (page - 1) * pageSize);

    const rows = db.prepare(sql).all(...params) as any[];
    const contacts = rows.map((r) => {
      let extra: Record<string, string> = {};
      try {
        extra = JSON.parse(r.imported_fields || '{}');
      } catch {}
      return {
        id: r.id,
        phoneE164: r.normalized_phone,
        name: r.name || '',
        valid: r.is_opted_out === 0,
        optOut: r.is_opted_out === 1,
        unchecked: false,
        extra,
      };
    });

    sendJson(res, 200, {
      contacts,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    });
    return true;
  }

  const baseExtraKeysMatch = pathname.match(/^\/api\/v1\/bases\/([^/]+)\/extra-keys$/);
  if (baseExtraKeysMatch && baseExtraKeysMatch[1] && method === 'GET') {
    const baseId = baseExtraKeysMatch[1];
    const rows = db.prepare('SELECT imported_fields FROM base_memberships WHERE base_id = ? LIMIT 100').all(baseId) as any[];
    const keys = new Set<string>();
    for (const r of rows) {
      try {
        const obj = JSON.parse(r.imported_fields || '{}');
        for (const k of Object.keys(obj)) keys.add(k);
      } catch {}
    }
    sendJson(res, 200, Array.from(keys));
    return true;
  }

  const baseExportMatch = pathname.match(/^\/api\/v1\/bases\/([^/]+)\/export$/);
  if (baseExportMatch && baseExportMatch[1] && method === 'GET') {
    const baseId = baseExportMatch[1];
    const csvData = csvExporter.exportToString(baseId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="base-${baseId}.csv"`);
    res.end(csvData);
    return true;
  }

  if (pathname === '/api/v1/bases/template' && method === 'GET') {
    const template = 'Nome,Telefone,Empresa,Cidade\nRafael Medeiros,+5511999998888,Dispar Flux,Sao Paulo\nAna Souza,+5511988887777,Agencia Flux,Campinas\n';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-contatos.csv"');
    res.end(template);
    return true;
  }

  const baseImportMatch = pathname.match(/^\/api\/v1\/bases\/([^/]+)\/import$/);
  if (baseImportMatch && baseImportMatch[1] && method === 'POST') {
    const baseId = baseImportMatch[1];
    const body = (await (server as any).sizeLimits.readJson(req)) as {
      rows: Array<Record<string, string>>;
      mapping: { nameColumn?: string; phoneColumn?: string; extraColumns?: string[] };
    };

    const now = new Date().toISOString();
    let imported = 0;
    let duplicates = 0;

    db.transaction(() => {
      for (const row of body.rows || []) {
        const rawPhone = body.mapping.phoneColumn ? row[body.mapping.phoneColumn] : Object.values(row)[1] || Object.values(row)[0];
        const rawName = body.mapping.nameColumn ? row[body.mapping.nameColumn] : Object.values(row)[0];

        let normalized = '';
        try {
          normalized = String(normalizePhoneNumber(rawPhone || ''));
        } catch {
          continue;
        }

        const extra: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k !== body.mapping.nameColumn && k !== body.mapping.phoneColumn) {
            extra[k] = String(v);
          }
        }

        let contactId = '';
        const existing = db.prepare('SELECT id FROM contacts WHERE organization_id = ? AND normalized_phone = ?').get(getOrgId(), normalized) as { id: string } | undefined;
        if (existing) {
          contactId = existing.id;
          duplicates++;
        } else {
          contactId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          `).run(contactId, getOrgId(), normalized, rawName || null, JSON.stringify(extra), now, now);
        }

        db.prepare(`
          INSERT OR REPLACE INTO base_memberships (id, base_id, contact_id, imported_fields, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), baseId, contactId, JSON.stringify(extra), now, now);
        imported++;
      }
    })();

    sendJson(res, 200, { totalRows: body.rows?.length || 0, imported, duplicatesConsolidated: duplicates, invalidRows: 0 });
    return true;
  }

  // --------------------------------------------------------------------------
  // 3. Campaign Planning & Execution Endpoints
  // --------------------------------------------------------------------------
  if (pathname === '/api/v1/campaigns/plan' && method === 'POST') {
    const body = (await (server as any).sizeLimits.readJson(req)) as {
      listId: string;
      mode: string;
      config: any;
      skipAlreadySent: boolean;
    };

    const stats = db.prepare(`
      SELECT COUNT(c.id) as total, SUM(CASE WHEN c.is_opted_out = 0 THEN 1 ELSE 0 END) as eligible
      FROM base_memberships bm
      JOIN contacts c ON c.id = bm.contact_id
      WHERE bm.base_id = ?
    `).get(body.listId) as { total: number; eligible: number } | undefined;

    const eligible = stats?.eligible || 0;
    const estSeconds = eligible * 18; // ~18s average pacing

    sendJson(res, 200, {
      eligibleContacts: eligible,
      totalContacts: stats?.total || 0,
      optedOutContacts: (stats?.total || 0) - eligible,
      alreadySentContacts: 0,
      estimatedSeconds: estSeconds,
      combinations: body.mode === 'paragraph' ? 24 : 1,
    });
    return true;
  }

  if (pathname === '/api/v1/campaigns/active' && method === 'GET') {
    const active = db.prepare("SELECT * FROM campaigns WHERE status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1").get() as any;
    if (!active) {
      sendJson(res, 200, null);
      return true;
    }
    sendJson(res, 200, {
      campaignId: active.id,
      name: active.name,
      status: active.status,
      total: active.snapshot_total,
      sent: active.sent_count,
      failed: active.failed_count,
      pending: active.snapshot_total - active.sent_count - active.failed_count,
      currentPhone: null,
      delayRemaining: 0,
    });
    return true;
  }

  if (pathname === '/api/v1/campaigns/start' && method === 'POST') {
    const body = (await (server as any).sizeLimits.readJson(req)) as any;
    const campaignId = crypto.randomUUID();
    const now = new Date().toISOString();

    const members = db.prepare(`
      SELECT c.id, c.normalized_phone, c.name, bm.imported_fields
      FROM base_memberships bm
      JOIN contacts c ON c.id = bm.contact_id
      WHERE bm.base_id = ? AND c.is_opted_out = 0
    `).all(body.listId) as any[];

    db.transaction(() => {
      db.prepare(`
        INSERT INTO campaigns (id, organization_id, connection_id, base_id, name, status, message_template, pacing_interval_seconds, daily_limit, confirmed_responsibility, snapshot_total, sent_count, failed_count, started_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, 1, ?, 0, 0, ?, ?, ?)
      `).run(
        campaignId,
        getOrgId(),
        getConnectionId(),
        body.listId,
        body.name || 'Disparo ' + new Date().toLocaleDateString('pt-BR'),
        body.config?.text || 'Mensagem Padrão',
        body.sending?.minInterval || 15,
        body.sending?.dailyLimit || 200,
        members.length,
        now,
        now,
        now
      );

      for (const m of members) {
        db.prepare(`
          INSERT INTO campaign_jobs (id, campaign_id, contact_id, normalized_phone, rendered_message, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(crypto.randomUUID(), campaignId, m.id, m.normalized_phone, body.config?.text || '', now, now);
      }
    })();

    // Notify clients of campaign progress
    (server as any).broadcast('campaign:progress', {
      campaignId,
      name: body.name,
      status: 'running',
      total: members.length,
      sent: 0,
      failed: 0,
      pending: members.length,
    });

    sendJson(res, 200, {
      campaignId,
      name: body.name,
      status: 'running',
      total: members.length,
      sent: 0,
      failed: 0,
      pending: members.length,
    });
    return true;
  }

  if (pathname === '/api/v1/campaigns/pause' && method === 'POST') {
    db.prepare("UPDATE campaigns SET status = 'paused' WHERE status = 'running'").run();
    (server as any).broadcast('campaign:stopped', { status: 'paused' });
    sendJson(res, 200, { success: true });
    return true;
  }

  if (pathname === '/api/v1/campaigns/cancel' && method === 'POST') {
    db.prepare("UPDATE campaigns SET status = 'canceled' WHERE status IN ('running', 'paused')").run();
    (server as any).broadcast('campaign:stopped', { status: 'canceled' });
    sendJson(res, 200, { success: true });
    return true;
  }

  const campaignJobsMatch = pathname.match(/^\/api\/v1\/campaigns\/([^/]+)\/jobs$/);
  if (campaignJobsMatch && campaignJobsMatch[1] && method === 'GET') {
    const campaignId = campaignJobsMatch[1];
    const rows = db.prepare(`
      SELECT j.*, c.name as contact_name
      FROM campaign_jobs j
      LEFT JOIN contacts c ON c.id = j.contact_id
      WHERE j.campaign_id = ?
      ORDER BY j.created_at ASC LIMIT 100
    `).all(campaignId) as any[];

    const jobs = rows.map((r) => ({
      id: r.id,
      phone: r.normalized_phone,
      name: r.contact_name,
      status: r.status,
      error: r.error_reason,
      sentAt: r.sent_at ? new Date(r.sent_at).getTime() : null,
      renderedText: r.rendered_message,
    }));
    sendJson(res, 200, jobs);
    return true;
  }

  if (pathname === '/api/v1/campaigns/draft' && method === 'GET') {
    const row = db.prepare('SELECT draft_json FROM campaign_drafts WHERE id = ?').get('current') as { draft_json: string } | undefined;
    sendJson(res, 200, row ? JSON.parse(row.draft_json) : null);
    return true;
  }

  if (pathname === '/api/v1/campaigns/draft' && method === 'POST') {
    const body = await (server as any).sizeLimits.readJson(req);
    const now = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO campaign_drafts (id, draft_json, updated_at) VALUES (?, ?, ?)').run('current', JSON.stringify(body), now);
    sendJson(res, 200, { success: true });
    return true;
  }

  // --------------------------------------------------------------------------
  // 4. Inbox & Messaging Endpoints
  // --------------------------------------------------------------------------
  if (pathname === '/api/v1/inbox/chats' && method === 'GET') {
    const rows = db.prepare(`
      SELECT c.*, ct.normalized_phone, ct.name as contact_name, l.stage_id as lead_stage_id
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      LEFT JOIN leads l ON l.contact_id = ct.id
      ORDER BY c.last_message_at DESC LIMIT 100
    `).all() as any[];

    const chats = rows.map((r) => ({
      jid: `${r.normalized_phone.replace('+', '')}@s.whatsapp.net`,
      name: r.contact_name || r.normalized_phone,
      lastMessage: 'Olá, como posso ajudar?',
      lastMessageTimestamp: r.last_message_at ? new Date(r.last_message_at).getTime() : Date.now(),
      unreadCount: r.unread_count || 0,
      avatarUrl: null,
      isLead: Boolean(r.lead_stage_id),
      optOut: false,
    }));
    sendJson(res, 200, chats);
    return true;
  }

  if (pathname === '/api/v1/inbox/total-unread' && method === 'GET') {
    const row = db.prepare('SELECT SUM(unread_count) as total FROM conversations').get() as { total: number } | undefined;
    sendJson(res, 200, row?.total || 0);
    return true;
  }

  if (pathname === '/api/v1/inbox/lead-count' && method === 'GET') {
    const row = db.prepare('SELECT COUNT(*) as total FROM leads').get() as { total: number } | undefined;
    sendJson(res, 200, row?.total || 0);
    return true;
  }

  const chatMessagesMatch = pathname.match(/^\/api\/v1\/inbox\/chats\/([^/]+)\/messages$/);
  if (chatMessagesMatch && chatMessagesMatch[1] && method === 'GET') {
    const jid = decodeURIComponent(chatMessagesMatch[1]);
    const phone = '+' + jid.split('@')[0];

    const contact = db.prepare('SELECT id FROM contacts WHERE normalized_phone = ?').get(phone) as { id: string } | undefined;
    if (!contact) {
      sendJson(res, 200, []);
      return true;
    }

    const conversation = db.prepare('SELECT id FROM conversations WHERE contact_id = ?').get(contact.id) as { id: string } | undefined;
    if (!conversation) {
      sendJson(res, 200, []);
      return true;
    }

    const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100').all(conversation.id) as any[];
    const messages = rows.map((r) => ({
      id: r.id,
      chatJid: jid,
      direction: r.direction === 'inbound' ? 'in' : 'out',
      body: r.content,
      timestamp: new Date(r.created_at).getTime(),
      status: r.status,
      mediaKind: r.media_type ? 'image' : null,
      mediaPath: r.media_url,
      mediaMime: null,
    }));
    sendJson(res, 200, messages);
    return true;
  }

  const chatSendMatch = pathname.match(/^\/api\/v1\/inbox\/chats\/([^/]+)\/send$/);
  if (chatSendMatch && chatSendMatch[1] && method === 'POST') {
    const jid = decodeURIComponent(chatSendMatch[1]);
    const body = (await (server as any).sizeLimits.readJson(req)) as { text: string };
    const phone = '+' + jid.split('@')[0];
    const now = new Date().toISOString();

    let contact = db.prepare('SELECT id FROM contacts WHERE normalized_phone = ?').get(phone) as { id: string } | undefined;
    if (!contact) {
      const contactId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
        VALUES (?, ?, ?, ?, '{}', 0, ?, ?)
      `).run(contactId, getOrgId(), phone, phone, now, now);
      contact = { id: contactId };
    }

    let conv = db.prepare('SELECT id FROM conversations WHERE contact_id = ?').get(contact.id) as { id: string } | undefined;
    if (!conv) {
      const convId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO conversations (id, organization_id, connection_id, contact_id, unread_count, last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      `).run(convId, getOrgId(), getConnectionId(), contact.id, now, now, now);
      conv = { id: convId };
    }

    const messageId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, direction, type, kind, content, status, created_at)
      VALUES (?, ?, 'outbound', 'manual', 'manual', ?, 'delivered', ?)
    `).run(messageId, conv.id, body.text, now);

    (server as any).broadcast('inbox:changed', { chatJid: jid });

    sendJson(res, 201, {
      id: messageId,
      chatJid: jid,
      direction: 'out',
      body: body.text,
      timestamp: Date.now(),
      status: 'delivered',
    });
    return true;
  }

  // --------------------------------------------------------------------------
  // 5. CRM Kanban & Funnel Endpoints
  // --------------------------------------------------------------------------
  if (pathname === '/api/v1/crm/board' && method === 'GET') {
    const funnel = db.prepare('SELECT * FROM funnels WHERE organization_id = ? LIMIT 1').get(getOrgId()) as any;
    let stages = [
      { id: 'st_1', name: 'Aguardando Resposta', order: 0 },
      { id: 'st_2', name: 'Em Andamento', order: 1 },
      { id: 'st_3', name: 'Proposta Enviada', order: 2 },
      { id: 'st_4', name: 'Fechado / Ganho', order: 3 },
    ];
    if (funnel) {
      try {
        stages = JSON.parse(funnel.stages);
      } catch {}
    } else {
      db.prepare('INSERT INTO funnels (id, organization_id, name, stages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('fn_default', getOrgId(), 'Funil de Vendas', JSON.stringify(stages), new Date().toISOString(), new Date().toISOString());
    }

    const leadsRows = db.prepare(`
      SELECT l.*, c.normalized_phone, c.name as contact_name
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id
      WHERE l.organization_id = ?
    `).all(getOrgId()) as any[];

    const leads = leadsRows.map((r) => ({
      id: r.id,
      contactId: r.contact_id,
      chatJid: `${r.normalized_phone.replace('+', '')}@s.whatsapp.net`,
      name: r.contact_name || r.normalized_phone,
      phone: r.normalized_phone,
      stageId: r.stage_id,
      notes: r.notes || '',
      firstSentAt: r.created_at ? new Date(r.created_at).getTime() : null,
      firstReplyAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
    }));

    sendJson(res, 200, { stages, leads });
    return true;
  }

  const leadStageMatch = pathname.match(/^\/api\/v1\/crm\/leads\/([^/]+)\/stage$/);
  if (leadStageMatch && leadStageMatch[1] && method === 'POST') {
    const leadId = leadStageMatch[1];
    const body = (await (server as any).sizeLimits.readJson(req)) as { stageId: string };
    db.prepare('UPDATE leads SET stage_id = ?, updated_at = ? WHERE id = ?').run(body.stageId, new Date().toISOString(), leadId);
    (server as any).broadcast('crm:changed', {});
    sendJson(res, 200, { success: true });
    return true;
  }

  const leadNotesMatch = pathname.match(/^\/api\/v1\/crm\/leads\/([^/]+)\/notes$/);
  if (leadNotesMatch && leadNotesMatch[1] && method === 'PATCH') {
    const leadId = leadNotesMatch[1];
    const body = (await (server as any).sizeLimits.readJson(req)) as { notes: string };
    db.prepare('UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?').run(body.notes, new Date().toISOString(), leadId);
    sendJson(res, 200, { success: true });
    return true;
  }

  // --------------------------------------------------------------------------
  // 6. Agenda & Appointments Endpoints
  // --------------------------------------------------------------------------
  if (pathname === '/api/v1/agenda' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM appointments WHERE organization_id = ? ORDER BY scheduled_start_time ASC').all(getOrgId()) as any[];
    const appointments = rows.map((r) => ({
      id: r.id,
      title: r.title,
      notes: r.description,
      scheduledAt: new Date(r.scheduled_start_time).getTime(),
      done: r.status === 'completed',
    }));
    sendJson(res, 200, appointments);
    return true;
  }

  if (pathname === '/api/v1/agenda' && method === 'POST') {
    const body = (await (server as any).sizeLimits.readJson(req)) as { title: string; notes?: string; scheduledAt: number };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const scheduled = new Date(body.scheduledAt || Date.now()).toISOString();

    db.prepare(`
      INSERT INTO appointments (id, organization_id, contact_id, title, description, scheduled_start_time, scheduled_end_time, status, created_at, updated_at)
      VALUES (?, ?, 'ct_none', ?, ?, ?, ?, 'scheduled', ?, ?)
    `).run(id, getOrgId(), body.title, body.notes || '', scheduled, scheduled, now, now);

    sendJson(res, 201, { id, title: body.title, notes: body.notes, scheduledAt: body.scheduledAt, done: false });
    return true;
  }

  // --------------------------------------------------------------------------
  // 7. Follow-up (Cron) Endpoints
  // --------------------------------------------------------------------------
  if (pathname === '/api/v1/followups' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM follow_up_rules WHERE organization_id = ?').all(getOrgId()) as any[];
    const rules = rows.map((r) => ({
      id: r.id,
      name: r.name,
      afterHours: Math.round(r.delay_interval_seconds / 3600),
      mode: 'fixed',
      config: { text: r.message_template },
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 9 * 60,
      endMinute: 18 * 60,
      maxFollowUps: r.max_attempts,
      enabled: r.is_active === 1,
    }));
    sendJson(res, 200, rules);
    return true;
  }

  // --------------------------------------------------------------------------
  // 8. Settings Endpoints
  // --------------------------------------------------------------------------
  if (pathname === '/api/v1/settings/sending-defaults' && method === 'GET') {
    sendJson(res, 200, { minInterval: 15, maxInterval: 30, dailyLimit: 150 });
    return true;
  }

  if (pathname === '/api/v1/settings/sending-defaults' && method === 'POST') {
    sendJson(res, 200, { success: true });
    return true;
  }

  if (pathname === '/api/v1/settings/ai' && method === 'GET') {
    sendJson(res, 200, { provider: 'google', model: 'gemini-2.0-flash', configured: true });
    return true;
  }

  if (pathname === '/api/v1/settings/ai' && method === 'POST') {
    sendJson(res, 200, { success: true });
    return true;
  }

  return false;
}
