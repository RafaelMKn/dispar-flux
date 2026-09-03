import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type AuditActorType,
  type AuditRecord,
  createAuditRecord,
} from '@dispar-flux/domain';

export interface LogAuditParams {
  organizationId: string;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

export interface QueryAuditParams {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}

export class AuditLogger {
  constructor(private readonly db: DatabaseConnection) {}

  /**
   * Logs an essential audit event in SQLite audit_records table.
   * Metadata is automatically sanitized to remove passwords, tokens, and PII.
   */
  log(params: LogAuditParams): AuditRecord {
    const record = createAuditRecord({
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      actorType: params.actorType,
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata,
      timestamp: params.timestamp,
    });

    const stmt = this.db.prepare(`
      INSERT INTO audit_records (
        id,
        organization_id,
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        metadata,
        timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.organizationId,
      record.actorType,
      record.actorId,
      record.action,
      record.targetType,
      record.targetId,
      record.metadata ? JSON.stringify(record.metadata) : null,
      record.timestamp.toISOString()
    );

    return record;
  }

  /**
   * Queries audit records for an organization with optional filtering and pagination.
   */
  query(organizationId: string, filter: QueryAuditParams = {}): AuditRecord[] {
    const conditions = ['organization_id = ?'];
    const bindings: (string | number)[] = [organizationId];

    if (filter.actorId) {
      conditions.push('actor_id = ?');
      bindings.push(filter.actorId);
    }
    if (filter.action) {
      conditions.push('action = ?');
      bindings.push(filter.action);
    }
    if (filter.targetType) {
      conditions.push('target_type = ?');
      bindings.push(filter.targetType);
    }
    if (filter.targetId) {
      conditions.push('target_id = ?');
      bindings.push(filter.targetId);
    }

    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const sql = `
      SELECT
        id,
        organization_id AS organizationId,
        actor_type AS actorType,
        actor_id AS actorId,
        action,
        target_type AS targetType,
        target_id AS targetId,
        metadata,
        timestamp
      FROM audit_records
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;

    bindings.push(limit, offset);

    const rows = this.db.prepare(sql).all(...bindings) as unknown as Array<{
      id: string;
      organizationId: string;
      actorType: AuditActorType;
      actorId: string;
      action: string;
      targetType: string;
      targetId: string;
      metadata: string | null;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      timestamp: new Date(row.timestamp),
    }));
  }
}
