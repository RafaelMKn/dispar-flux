import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  createMessage,
  type Message,
  type CreateMessageParams,
  type MessageDeliveryStatus,
  type MessageDirection,
  type MessageKind,
  type MessageType,
} from '@dispar-flux/domain';
import type { PaginatedResult, PaginationOptions, SearchMessagesOptions } from '../types.js';

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  type: string;
  kind: string;
  content: string | null;
  media_url: string | null;
  media_type: string | null;
  external_id: string | null;
  sender_member_id: string | null;
  campaign_job_id: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

export class MessageRepository {
  constructor(private readonly conn: DatabaseConnection) {}

  private mapRow(row: MessageRow): Message {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      direction: row.direction as MessageDirection,
      type: row.type as MessageType,
      kind: row.kind as MessageKind,
      content: row.content || '',
      mediaUrl: row.media_url || undefined,
      mediaType: row.media_type || undefined,
      externalId: row.external_id || undefined,
      senderMemberId: row.sender_member_id || undefined,
      campaignJobId: row.campaign_job_id || undefined,
      status: row.status as MessageDeliveryStatus,
      sentAt: row.sent_at ? new Date(row.sent_at) : undefined,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at) : undefined,
      readAt: row.read_at ? new Date(row.read_at) : undefined,
      createdAt: new Date(row.created_at),
    };
  }

  create(params: CreateMessageParams): Message {
    const id = params.id || `msg_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const message = createMessage({
      ...params,
      id,
    });

    const stmt = this.conn.prepare(`
      INSERT INTO messages (
        id, conversation_id, direction, type, kind,
        content, media_url, media_type, external_id,
        sender_member_id, campaign_job_id, status,
        sent_at, delivered_at, read_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      message.conversationId,
      message.direction,
      message.type,
      message.kind,
      message.content,
      message.mediaUrl || null,
      message.mediaType || null,
      message.externalId || null,
      message.senderMemberId || null,
      message.campaignJobId || null,
      message.status,
      message.sentAt ? message.sentAt.toISOString() : null,
      message.deliveredAt ? message.deliveredAt.toISOString() : null,
      message.readAt ? message.readAt.toISOString() : null,
      message.createdAt.toISOString()
    );

    return message;
  }

  findById(id: string): Message | null {
    const stmt = this.conn.prepare('SELECT * FROM messages WHERE id = ?');
    const row = stmt.get(id) as MessageRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByExternalId(externalId: string): Message | null {
    const stmt = this.conn.prepare('SELECT * FROM messages WHERE external_id = ?');
    const row = stmt.get(externalId) as MessageRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Lists messages for a conversation with support for offset and cursor pagination.
   */
  listByConversation(
    conversationId: string,
    options: PaginationOptions = {}
  ): PaginatedResult<Message> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const direction = options.direction ?? 'asc'; // 'asc' for chronological chat, 'desc' for latest first

    // Query total count
    const countStmt = this.conn.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?');
    const countRow = countStmt.get(conversationId) as { count: number };
    const total = countRow.count;

    if (options.cursor) {
      // Decode cursor: base64(createdAt|id)
      let cursorDateStr: string;
      let cursorId: string;
      try {
        const decoded = Buffer.from(options.cursor, 'base64').toString('utf-8');
        const [d, id] = decoded.split('|');
        cursorDateStr = d || '';
        cursorId = id || '';
      } catch {
        cursorDateStr = options.cursor;
        cursorId = '';
      }

      const orderOp = direction === 'asc' ? '>' : '<';
      const orderSql = direction === 'asc' ? 'ASC' : 'DESC';

      const cursorQuery = `
        SELECT * FROM messages
        WHERE conversation_id = ?
          AND (created_at ${orderOp} ? OR (created_at = ? AND id ${orderOp} ?))
        ORDER BY created_at ${orderSql}, id ${orderSql}
        LIMIT ?
      `;

      const rows = this.conn
        .prepare(cursorQuery)
        .all(conversationId, cursorDateStr, cursorDateStr, cursorId, limit + 1) as unknown as MessageRow[];

      const hasNext = rows.length > limit;
      const sliced = hasNext ? rows.slice(0, limit) : rows;
      const items = sliced.map((r) => this.mapRow(r));

      let nextCursor: string | undefined;
      if (hasNext && sliced.length > 0) {
        const lastItem = sliced[sliced.length - 1];
        if (lastItem) {
          nextCursor = Buffer.from(`${lastItem.created_at}|${lastItem.id}`).toString('base64');
        }
      }

      return {
        items,
        total,
        limit,
        nextCursor,
      };
    }

    // Offset-based pagination
    const offset = Math.max(0, options.offset ?? 0);
    const orderSql = direction === 'asc' ? 'ASC' : 'DESC';
    const listStmt = this.conn.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ${orderSql}, id ${orderSql}
      LIMIT ? OFFSET ?
    `);

    const rows = listStmt.all(conversationId, limit, offset) as unknown as MessageRow[];
    const items = rows.map((r) => this.mapRow(r));

    let nextCursor: string | undefined;
    if (offset + items.length < total && items.length > 0) {
      const lastItem = items[items.length - 1];
      if (lastItem) {
        nextCursor = Buffer.from(`${lastItem.createdAt.toISOString()}|${lastItem.id}`).toString('base64');
      }
    }

    return {
      items,
      total,
      limit,
      offset,
      nextCursor,
    };
  }

  updateDeliveryStatus(
    id: string,
    status: MessageDeliveryStatus,
    timestamp: Date = new Date()
  ): Message | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const timeIso = timestamp.toISOString();
    let sentAt = existing.sentAt ? existing.sentAt.toISOString() : null;
    let deliveredAt = existing.deliveredAt ? existing.deliveredAt.toISOString() : null;
    let readAt = existing.readAt ? existing.readAt.toISOString() : null;

    if (status === 'sent' && !sentAt) {
      sentAt = timeIso;
    } else if (status === 'delivered') {
      if (!sentAt) sentAt = timeIso;
      deliveredAt = timeIso;
    } else if (status === 'read') {
      if (!sentAt) sentAt = timeIso;
      if (!deliveredAt) deliveredAt = timeIso;
      readAt = timeIso;
    }

    const stmt = this.conn.prepare(`
      UPDATE messages
      SET status = ?, sent_at = ?, delivered_at = ?, read_at = ?
      WHERE id = ?
    `);
    stmt.run(status, sentAt, deliveredAt, readAt, id);

    return this.findById(id);
  }

  /**
   * Synchronizes read status by marking all pending unread inbound messages as read.
   */
  markMessagesAsRead(conversationId: string, readAt: Date = new Date()): number {
    const timeIso = readAt.toISOString();
    const stmt = this.conn.prepare(`
      UPDATE messages
      SET status = 'read', read_at = ?
      WHERE conversation_id = ?
        AND direction = 'inbound'
        AND status != 'read'
    `);
    const result = stmt.run(timeIso, conversationId);
    return Number(result.changes);
  }

  /**
   * Searches messages within the database across conversations.
   */
  search(options: SearchMessagesOptions): PaginatedResult<Message> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const offset = Math.max(0, options.offset ?? 0);
    const searchPattern = `%${options.query.trim()}%`;

    const conditions = [
      'c.organization_id = ?',
      'm.content LIKE ?',
    ];
    const args: (string | number)[] = [options.organizationId, searchPattern];

    if (options.conversationId) {
      conditions.push('m.conversation_id = ?');
      args.push(options.conversationId);
    }
    if (options.connectionId) {
      conditions.push('c.connection_id = ?');
      args.push(options.connectionId);
    }
    if (options.contactId) {
      conditions.push('c.contact_id = ?');
      args.push(options.contactId);
    }

    const whereClause = conditions.join(' AND ');

    const countStmt = this.conn.prepare(`
      SELECT COUNT(*) as count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE ${whereClause}
    `);
    const countRow = countStmt.get(...args) as { count: number };
    const total = countRow.count;

    const queryStmt = this.conn.prepare(`
      SELECT m.*
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = queryStmt.all(...args, limit, offset) as unknown as MessageRow[];
    return {
      items: rows.map((r) => this.mapRow(r)),
      total,
      limit,
      offset,
    };
  }
}
