import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  createConversation,
  type Conversation,
  type CreateConversationParams,
} from '@dispar-flux/domain';

interface ConversationRow {
  id: string;
  organization_id: string;
  connection_id: string;
  contact_id: string;
  unread_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ConversationRepository {
  constructor(private readonly conn: DatabaseConnection) {}

  private mapRow(row: ConversationRow): Conversation {
    return {
      id: row.id,
      organizationId: row.organization_id,
      connectionId: row.connection_id,
      contactId: row.contact_id,
      unreadCount: row.unread_count,
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  create(params: {
    id?: string;
    organizationId: string;
    connectionId: string;
    contactId: string;
    unreadCount?: number;
    lastMessageAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
  }): Conversation {
    const id = params.id || `conv_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date();
    const createdAt = params.createdAt || now;
    const updatedAt = params.updatedAt || now;

    const conversation = createConversation({
      id,
      organizationId: params.organizationId,
      connectionId: params.connectionId,
      contactId: params.contactId,
      unreadCount: params.unreadCount ?? 0,
      lastMessageAt: params.lastMessageAt,
      createdAt,
      updatedAt,
    });

    const stmt = this.conn.prepare(`
      INSERT INTO conversations (
        id, organization_id, connection_id, contact_id,
        unread_count, last_message_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      conversation.id,
      conversation.organizationId,
      conversation.connectionId,
      conversation.contactId,
      conversation.unreadCount,
      conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
      conversation.createdAt.toISOString(),
      conversation.updatedAt.toISOString()
    );

    return conversation;
  }

  findById(id: string): Conversation | null {
    const stmt = this.conn.prepare('SELECT * FROM conversations WHERE id = ?');
    const row = stmt.get(id) as ConversationRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByConnectionAndContact(connectionId: string, contactId: string): Conversation | null {
    const stmt = this.conn.prepare(`
      SELECT * FROM conversations
      WHERE connection_id = ? AND contact_id = ?
    `);
    const row = stmt.get(connectionId, contactId) as ConversationRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  listByOrganization(params: {
    organizationId: string;
    connectionId?: string;
    contactId?: string;
    limit?: number;
    offset?: number;
  }): { conversations: Conversation[]; total: number } {
    const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
    const offset = Math.max(0, params.offset ?? 0);

    const conditions = ['organization_id = ?'];
    const args: (string | number)[] = [params.organizationId];

    if (params.connectionId) {
      conditions.push('connection_id = ?');
      args.push(params.connectionId);
    }
    if (params.contactId) {
      conditions.push('contact_id = ?');
      args.push(params.contactId);
    }

    const whereClause = conditions.join(' AND ');

    const countStmt = this.conn.prepare(`SELECT COUNT(*) as count FROM conversations WHERE ${whereClause}`);
    const countRow = countStmt.get(...args) as { count: number };
    const total = countRow.count;

    const listStmt = this.conn.prepare(`
      SELECT * FROM conversations
      WHERE ${whereClause}
      ORDER BY COALESCE(last_message_at, created_at) DESC
      LIMIT ? OFFSET ?
    `);
    const rows = listStmt.all(...args, limit, offset) as unknown as ConversationRow[];

    return {
      conversations: rows.map((r) => this.mapRow(r)),
      total,
    };
  }

  /**
   * Retrieves all conversations for a contact across all connections,
   * enabling chronological aggregation in the UI while preserving partition isolation (ADR 0039).
   */
  listByContact(organizationId: string, contactId: string): Conversation[] {
    const stmt = this.conn.prepare(`
      SELECT * FROM conversations
      WHERE organization_id = ? AND contact_id = ?
      ORDER BY COALESCE(last_message_at, created_at) DESC
    `);
    const rows = stmt.all(organizationId, contactId) as unknown as ConversationRow[];
    return rows.map((r) => this.mapRow(r));
  }

  incrementUnread(id: string): void {
    const now = new Date().toISOString();
    const stmt = this.conn.prepare(`
      UPDATE conversations
      SET unread_count = unread_count + 1, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, id);
  }

  resetUnread(id: string): void {
    const now = new Date().toISOString();
    const stmt = this.conn.prepare(`
      UPDATE conversations
      SET unread_count = 0, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(now, id);
  }

  updateLastMessage(id: string, timestamp: Date): void {
    const now = new Date().toISOString();
    const stmt = this.conn.prepare(`
      UPDATE conversations
      SET last_message_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(timestamp.toISOString(), now, id);
  }
}
