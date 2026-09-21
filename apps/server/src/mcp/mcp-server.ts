import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import type { DisparFluxServer } from '../server.js';
import { normalizePhoneNumber } from '@dispar-flux/domain';
import { Permission, hasPermission, type AuthenticatedContext } from '@dispar-flux/auth';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  requiredPermission: Permission;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'df_list_funnel_leads',
    description: 'Lista Leads de um Funil comercial filtrados por etapa ou tempo de inatividade',
    inputSchema: {
      type: 'object',
      properties: {
        funnelId: { type: 'string', description: 'ID do Funil (opcional, usa o padrão se omitido)' },
        stageId: { type: 'string', description: 'ID da etapa do funil' },
        inactiveHours: { type: 'number', description: 'Filtrar leads inativos há pelo menos N horas' },
        limit: { type: 'number', description: 'Quantidade máxima de resultados (padrão 50)' },
      },
    },
    requiredPermission: Permission.CRM_READ,
  },
  {
    name: 'df_get_lead_details',
    description: 'Retorna o perfil completo do Lead, dados do contato e histórico recente da conversa',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'ID do Lead' },
        phone: { type: 'string', description: 'Telefone do contato (caso não possua o leadId)' },
      },
    },
    requiredPermission: Permission.CRM_READ,
  },
  {
    name: 'df_move_lead_stage',
    description: 'Move um Lead para outra etapa do Funil com registro de nota e auditoria',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'ID do Lead a ser movido' },
        targetStageId: { type: 'string', description: 'ID da nova etapa de destino' },
        internalNote: { type: 'string', description: 'Nota explicativa ou motivo da movimentação' },
      },
      required: ['leadId', 'targetStageId'],
    },
    requiredPermission: Permission.CRM_WRITE,
  },
  {
    name: 'df_send_manual_message',
    description: 'Envia uma Resposta Manual direta via Conexão de WhatsApp específica',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Telefone do destinatário' },
        text: { type: 'string', description: 'Conteúdo da mensagem de texto' },
        connectionId: { type: 'string', description: 'ID da Conexão WhatsApp (opcional)' },
      },
      required: ['phone', 'text'],
    },
    requiredPermission: Permission.INBOX_REPLY_MANUAL,
  },
  {
    name: 'df_register_opt_out',
    description: 'Registra Opt-out irrestrito para um Contato, bloqueando novos disparos automatizados',
    inputSchema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Telefone do contato' },
        reason: { type: 'string', description: 'Motivo declarado do descadastro/opt-out' },
      },
      required: ['phone', 'reason'],
    },
    requiredPermission: Permission.BASES_MANAGE,
  },
  {
    name: 'df_get_campaign_health',
    description: 'Retorna o status ao vivo das Campanhas e Conexões de Mensageria da Organização',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    requiredPermission: Permission.CAMPAIGNS_MANAGE,
  },
];

interface ActiveSseSession {
  res: ServerResponse;
  authContext: AuthenticatedContext;
}

export class McpServer {
  private server: DisparFluxServer;
  private activeSessions = new Map<string, ActiveSseSession>();

  constructor(server: DisparFluxServer) {
    this.server = server;
  }

  private hasPermissionForTool(tool: McpToolDefinition, authContext: AuthenticatedContext): boolean {
    const member = authContext.member as any;
    if (member?.isServiceAccount) {
      const scopes: string[] = member.scopes || [];
      if (scopes.includes('*') || scopes.includes(tool.requiredPermission)) return true;
      if (tool.requiredPermission === Permission.INBOX_REPLY_MANUAL && (scopes.includes('inbox:write') || scopes.includes('inbox:reply_manual'))) return true;
      if (tool.requiredPermission === Permission.BASES_MANAGE && (scopes.includes('contacts:write') || scopes.includes('bases:manage'))) return true;
      if (tool.requiredPermission === Permission.CAMPAIGNS_MANAGE && (scopes.includes('campaigns:read') || scopes.includes('campaigns:write') || scopes.includes('campaigns:manage'))) return true;
      return false;
    }
    return hasPermission(member.role, tool.requiredPermission);
  }

  public async handleRpc(authContext: AuthenticatedContext, rpc: any): Promise<any> {
    if (!rpc || typeof rpc !== 'object') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      };
    }

    const { id, method, params } = rpc;

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'dispar-flux-mcp',
            version: this.server.version || '1.0.0',
          },
        },
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      const tools = MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      return { jsonrpc: '2.0', id, result: { tools } };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      const toolDef = MCP_TOOLS.find((t) => t.name === toolName);
      if (!toolDef) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Tool not found: ${toolName}` },
        };
      }

      if (!this.hasPermissionForTool(toolDef, authContext)) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Erro de permissão: a conta não possui o escopo/permissão '${toolDef.requiredPermission}'.`,
              },
            ],
            isError: true,
          },
        };
      }

      try {
        const result = await this.executeTool(toolName, toolArgs, authContext);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
              },
            ],
            isError: false,
          },
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Erro ao executar ${toolName}: ${errorMsg}`,
              },
            ],
            isError: true,
          },
        };
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  private async executeTool(name: string, args: any, authContext: AuthenticatedContext): Promise<any> {
    const db = (this.server as any).db;
    const orgId = authContext.member.organizationId;
    const actorId = authContext.member.id;

    switch (name) {
      case 'df_list_funnel_leads': {
        let sql = `
          SELECT 
            l.id AS lead_id,
            l.funnel_id,
            l.stage_id,
            l.value,
            l.notes,
            l.created_at,
            l.updated_at,
            c.id AS contact_id,
            c.name AS contact_name,
            c.normalized_phone,
            c.is_opted_out
          FROM leads l
          JOIN contacts c ON l.contact_id = c.id
          WHERE l.organization_id = ?
        `;
        const queryParams: any[] = [orgId];

        if (args.funnelId) {
          sql += ` AND l.funnel_id = ?`;
          queryParams.push(args.funnelId);
        }

        if (args.stageId) {
          sql += ` AND l.stage_id = ?`;
          queryParams.push(args.stageId);
        }

        if (args.inactiveHours && typeof args.inactiveHours === 'number') {
          sql += ` AND datetime(l.updated_at) <= datetime('now', '-' || ? || ' hours')`;
          queryParams.push(Math.max(1, Math.round(args.inactiveHours)));
        }

        sql += ` ORDER BY l.updated_at DESC LIMIT ?`;
        queryParams.push(Math.min(100, Math.max(1, Number(args.limit) || 50)));

        const rows = db.prepare(sql).all(...queryParams);
        return { count: rows.length, leads: rows };
      }

      case 'df_get_lead_details': {
        let contactRow: any = null;
        let leadRow: any = null;

        if (args.leadId) {
          leadRow = db.prepare(`
            SELECT * FROM leads WHERE id = ? AND organization_id = ?
          `).get(args.leadId, orgId);

          if (leadRow) {
            contactRow = db.prepare(`
              SELECT * FROM contacts WHERE id = ? AND organization_id = ?
            `).get(leadRow.contact_id, orgId);
          }
        } else if (args.phone) {
          const normPhone = normalizePhoneNumber(args.phone);
          contactRow = db.prepare(`
            SELECT * FROM contacts WHERE normalized_phone = ? AND organization_id = ?
          `).get(normPhone.e164, orgId);

          if (contactRow) {
            leadRow = db.prepare(`
              SELECT * FROM leads WHERE contact_id = ? AND organization_id = ? ORDER BY updated_at DESC LIMIT 1
            `).get(contactRow.id, orgId);
          }
        }

        if (!contactRow && !leadRow) {
          throw new Error('Lead ou Contato não encontrado para os parâmetros informados.');
        }

        let messages: any[] = [];
        if (contactRow) {
          messages = db.prepare(`
            SELECT m.id, m.direction, m.type, m.content, m.status, m.created_at
            FROM messages m
            JOIN conversations conv ON m.conversation_id = conv.id
            WHERE conv.contact_id = ? AND conv.organization_id = ?
            ORDER BY m.created_at DESC
            LIMIT 10
          `).all(contactRow.id, orgId);
        }

        return {
          lead: leadRow || null,
          contact: contactRow ? {
            id: contactRow.id,
            name: contactRow.name,
            phone: contactRow.normalized_phone,
            isOptedOut: Boolean(contactRow.is_opted_out),
            customFields: JSON.parse(contactRow.custom_fields || '{}'),
            notes: contactRow.notes,
          } : null,
          recentMessages: messages.reverse(),
        };
      }

      case 'df_move_lead_stage': {
        const { leadId, targetStageId, internalNote } = args;
        if (!leadId || !targetStageId) {
          throw new Error('leadId e targetStageId são obrigatórios.');
        }

        const existing = db.prepare(`
          SELECT * FROM leads WHERE id = ? AND organization_id = ?
        `).get(leadId, orgId) as any;

        if (!existing) {
          throw new Error(`Lead '${leadId}' não encontrado.`);
        }

        const previousStageId = existing.stage_id;
        const now = new Date().toISOString();
        let newNotes = existing.notes || '';
        if (internalNote) {
          newNotes = newNotes ? `${newNotes}\n[${now}] ${internalNote}` : `[${now}] ${internalNote}`;
        }

        db.prepare(`
          UPDATE leads
          SET stage_id = ?, notes = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `).run(targetStageId, newNotes, now, leadId, orgId);

        // Audit log
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, actor_id, action, target_id, details, created_at)
          VALUES (?, ?, ?, 'lead:stage_changed', ?, ?, ?)
        `).run(
          `aud_${crypto.randomUUID()}`,
          orgId,
          actorId,
          leadId,
          JSON.stringify({ previousStageId, targetStageId, internalNote }),
          now
        );

        // Outbound Webhook event
        if (this.server.webhookService) {
          this.server.webhookService.dispatch(orgId, 'lead.stage_changed', {
            leadId,
            contactId: existing.contact_id,
            previousStageId,
            targetStageId,
            internalNote: internalNote || null,
            movedAt: now,
          }).catch(() => {});
        }

        return {
          success: true,
          leadId,
          previousStageId,
          targetStageId,
          movedAt: now,
        };
      }

      case 'df_send_manual_message': {
        const { phone, text, connectionId } = args;
        if (!phone || !text) {
          throw new Error('phone e text são obrigatórios.');
        }

        const normalized = normalizePhoneNumber(phone);
        const now = new Date().toISOString();

        // 1. Resolve or create contact
        let contact = db.prepare(`
          SELECT * FROM contacts WHERE normalized_phone = ? AND organization_id = ?
        `).get(normalized.e164, orgId) as any;

        if (!contact) {
          const newContactId = `cnt_${crypto.randomUUID()}`;
          db.prepare(`
            INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
            VALUES (?, ?, ?, ?, '{}', 0, ?, ?)
          `).run(newContactId, orgId, normalized.e164, `Contato ${normalized.e164.slice(-4)}`, now, now);
          contact = { id: newContactId, normalized_phone: normalized.e164, is_opted_out: 0 };
        }

        // 2. Resolve messaging connection
        let connId = connectionId;
        if (!connId) {
          const defaultConn = db.prepare(`
            SELECT id FROM messaging_connections WHERE organization_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1
          `).get(orgId) as any;
          connId = defaultConn?.id || 'conn_default';
        }

        // 3. Resolve or create conversation
        let conversation = db.prepare(`
          SELECT id FROM conversations WHERE contact_id = ? AND connection_id = ? AND organization_id = ?
        `).get(contact.id, connId, orgId) as any;

        if (!conversation) {
          const convId = `conv_${crypto.randomUUID()}`;
          db.prepare(`
            INSERT INTO conversations (id, organization_id, connection_id, contact_id, unread_count, last_message_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?)
          `).run(convId, orgId, connId, contact.id, now, now, now);
          conversation = { id: convId };
        } else {
          db.prepare(`UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?`).run(now, now, conversation.id);
        }

        // 4. Save message (Manual kind, ADR 0043)
        const messageId = `msg_${crypto.randomUUID()}`;
        db.prepare(`
          INSERT INTO messages (id, conversation_id, direction, type, kind, content, status, sent_at, created_at)
          VALUES (?, ?, 'outbound', 'manual', 'manual', ?, 'sent', ?, ?)
        `).run(messageId, conversation.id, text, now, now);

        // 5. Attempt dispatch via Baileys if connected
        let dispatched = false;
        try {
          if (this.server.baileysConnector && this.server.baileysConnector.getStatus(connId) === 'connected') {
            await this.server.baileysConnector.sendMessage(connId, {
              to: normalized.e164,
              content: { text },
            });
            dispatched = true;
          }
        } catch {}

        return {
          success: true,
          messageId,
          conversationId: conversation.id,
          phone: normalized.e164,
          dispatched,
          timestamp: now,
        };
      }

      case 'df_register_opt_out': {
        const { phone, reason } = args;
        if (!phone || !reason) {
          throw new Error('phone e reason são obrigatórios.');
        }

        const normalized = normalizePhoneNumber(phone);
        const now = new Date().toISOString();

        // 1. Mark contact as opted out if exists
        const contact = db.prepare(`
          SELECT id FROM contacts WHERE normalized_phone = ? AND organization_id = ?
        `).get(normalized.e164, orgId) as any;

        if (contact) {
          db.prepare(`
            UPDATE contacts SET is_opted_out = 1, updated_at = ? WHERE id = ?
          `).run(now, contact.id);
        }

        // 2. Insert into opt_outs table (ADR 0040)
        const optOutId = `opt_${crypto.randomUUID()}`;
        db.prepare(`
          INSERT INTO opt_outs (id, organization_id, normalized_phone, contact_id, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(optOutId, orgId, normalized.e164, contact?.id || null, reason, now);

        // 3. Audit log
        db.prepare(`
          INSERT INTO audit_logs (id, organization_id, actor_id, action, target_id, details, created_at)
          VALUES (?, ?, ?, 'contact:opt_out', ?, ?, ?)
        `).run(
          `aud_${crypto.randomUUID()}`,
          orgId,
          actorId,
          normalized.e164,
          JSON.stringify({ reason, contactId: contact?.id || null }),
          now
        );

        // Outbound Webhook event
        if (this.server.webhookService) {
          this.server.webhookService.dispatch(orgId, 'opt_out.registered', {
            normalizedPhone: normalized.e164,
            contactId: contact?.id || null,
            reason,
            registeredAt: now,
          }).catch(() => {});
        }

        return {
          success: true,
          phone: normalized.e164,
          optOutId,
          reason,
          registeredAt: now,
        };
      }

      case 'df_get_campaign_health': {
        const connections = db.prepare(`
          SELECT id, name, provider, status, phone_number, created_at
          FROM messaging_connections
          WHERE organization_id = ?
        `).all(orgId) as any[];

        const maturationRows = db.prepare(`
          SELECT m.* FROM maturation_state m
          JOIN messaging_connections c ON m.connection_id = c.id
          WHERE c.organization_id = ?
        `).all(orgId) as any[];

        const activeCampaigns = db.prepare(`
          SELECT count(*) as count FROM campaigns
          WHERE organization_id = ? AND status IN ('running', 'scheduled')
        `).get(orgId) as any;

        const connectionsWithMaturation = connections.map((conn) => {
          const liveStatus = this.server.baileysConnector
            ? this.server.baileysConnector.getStatus(conn.id)
            : conn.status;
          const mat = maturationRows.find((m) => m.connection_id === conn.id);
          return {
            id: conn.id,
            name: conn.name,
            provider: conn.provider,
            status: liveStatus,
            phoneNumber: conn.phone_number,
            maturation: mat
              ? {
                  day: mat.current_day,
                  stage: mat.stage,
                  sentToday: mat.sent_today,
                  dailyCap: mat.daily_cap,
                  reportCount24h: mat.report_count_24h,
                }
              : null,
          };
        });

        return {
          success: true,
          connections: connectionsWithMaturation,
          activeCampaignsCount: activeCampaigns?.count || 0,
          checkedAt: new Date().toISOString(),
        };
      }

      default:
        throw new Error(`Tool implementation for ${name} not found`);
    }
  }

  public handleSse(req: IncomingMessage, res: ServerResponse, authContext: AuthenticatedContext): void {
    const sessionId = crypto.randomUUID();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    this.activeSessions.set(sessionId, { res, authContext });

    req.on('close', () => {
      this.activeSessions.delete(sessionId);
    });

    // Send initial SSE endpoint message (MCP standard SSE transport)
    res.write(`event: endpoint\ndata: /api/v1/mcp/messages?sessionId=${sessionId}\n\n`);
  }

  public async handleSseMessage(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string,
    body: any
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Session not found or expired' }));
      return;
    }

    const response = await this.handleRpc(session.authContext, body);
    if (response) {
      session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    }

    res.statusCode = 202;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'accepted' }));
  }

  public async handleDirectRpc(res: ServerResponse, authContext: AuthenticatedContext, body: any): Promise<void> {
    const response = await this.handleRpc(authContext, body);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(response));
  }
}
