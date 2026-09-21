import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  CampaignEngineError,
  ConnectionNotFoundError,
  CrossTenantViolationError,
  NoAvailableConnectionError,
  PoolNotFoundError,
} from '../errors.js';

export interface ConnectionPoolRow {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ConnectionPoolMemberRow {
  pool_id: string;
  connection_id: string;
  created_at: string;
  status?: string;
  name?: string;
  phone_number?: string | null;
}

export interface ConnectionPool {
  id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionPoolMember {
  poolId: string;
  connectionId: string;
  createdAt: Date;
  status?: string;
  name?: string;
  phoneNumber?: string | null;
}

export interface DistributedJob<T> {
  connectionId: string;
  job: T;
}

export function mapRowToPool(row: ConnectionPoolRow): ConnectionPool {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class MultiConnectionPoolService {
  private readonly roundRobinIndexes = new Map<string, number>();

  constructor(private readonly conn: DatabaseConnection) {}

  /**
   * Creates a new connection pool for an organization.
   * Optionally attaches initial connection IDs if provided.
   */
  createPool(orgId: string, name: string, connectionIds?: string[]): ConnectionPool {
    const trimmedName = name ? name.trim() : '';
    if (!trimmedName) {
      throw new CampaignEngineError('Pool name cannot be empty', 'INVALID_POOL_NAME');
    }

    const poolId = crypto.randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();

    return this.conn.transaction(() => {
      // Validate all connectionIds up front if provided
      if (connectionIds && connectionIds.length > 0) {
        for (const connId of connectionIds) {
          const connRow = this.conn
            .prepare('SELECT id, organization_id FROM messaging_connections WHERE id = ?')
            .get(connId) as { id: string; organization_id: string } | undefined;

          if (!connRow) {
            throw new ConnectionNotFoundError(connId);
          }
          if (connRow.organization_id !== orgId) {
            throw new CrossTenantViolationError(
              `Cross-tenant connection pool membership is forbidden: connection ${connId} does not belong to organization ${orgId}`
            );
          }
        }
      }

      this.conn
        .prepare(`
          INSERT INTO connection_pools (id, organization_id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(poolId, orgId, trimmedName, nowIso, nowIso);

      if (connectionIds && connectionIds.length > 0) {
        const insertMember = this.conn.prepare(`
          INSERT OR IGNORE INTO connection_pool_members (pool_id, connection_id, created_at)
          VALUES (?, ?, ?)
        `);
        for (const connId of connectionIds) {
          insertMember.run(poolId, connId, nowIso);
        }
      }

      return {
        id: poolId,
        organizationId: orgId,
        name: trimmedName,
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  /**
   * Retrieves a connection pool by ID scoped to the given organization.
   */
  getPool(orgId: string, poolId: string): ConnectionPool | null {
    const row = this.conn
      .prepare(`
        SELECT id, organization_id, name, created_at, updated_at
        FROM connection_pools
        WHERE id = ? AND organization_id = ?
      `)
      .get(poolId, orgId) as ConnectionPoolRow | undefined;

    if (!row) {
      return null;
    }

    return mapRowToPool(row);
  }

  /**
   * Lists all connection pools belonging to the given organization.
   */
  listPools(orgId: string): ConnectionPool[] {
    const rows = this.conn
      .prepare(`
        SELECT id, organization_id, name, created_at, updated_at
        FROM connection_pools
        WHERE organization_id = ?
        ORDER BY created_at ASC, id ASC
      `)
      .all(orgId) as unknown as ConnectionPoolRow[];

    return rows.map(mapRowToPool);
  }

  /**
   * Deletes a connection pool scoped to the organization.
   * Cascading deletes remove members automatically.
   */
  deletePool(orgId: string, poolId: string): boolean {
    const result = this.conn
      .prepare('DELETE FROM connection_pools WHERE id = ? AND organization_id = ?')
      .run(poolId, orgId);

    const stateKey = `${orgId}:${poolId}`;
    this.roundRobinIndexes.delete(stateKey);
    this.roundRobinIndexes.delete(poolId);

    return result.changes > 0;
  }

  /**
   * Adds a connection member to the pool after verifying multi-tenant isolation.
   */
  addMember(orgId: string, poolId: string, connectionId: string): void {
    const pool = this.getPool(orgId, poolId);
    if (!pool) {
      throw new PoolNotFoundError(poolId);
    }

    const connRow = this.conn
      .prepare('SELECT id, organization_id FROM messaging_connections WHERE id = ?')
      .get(connectionId) as { id: string; organization_id: string } | undefined;

    if (!connRow) {
      throw new ConnectionNotFoundError(connectionId);
    }

    if (connRow.organization_id !== orgId) {
      throw new CrossTenantViolationError(
        `Cross-tenant connection pool membership is forbidden: connection ${connectionId} does not belong to organization ${orgId}`
      );
    }

    const nowIso = new Date().toISOString();
    this.conn
      .prepare(`
        INSERT OR IGNORE INTO connection_pool_members (pool_id, connection_id, created_at)
        VALUES (?, ?, ?)
      `)
      .run(poolId, connectionId, nowIso);

    this.conn
      .prepare('UPDATE connection_pools SET updated_at = ? WHERE id = ? AND organization_id = ?')
      .run(nowIso, poolId, orgId);
  }

  /**
   * Removes a connection member from the pool.
   */
  removeMember(orgId: string, poolId: string, connectionId: string): void {
    const pool = this.getPool(orgId, poolId);
    if (!pool) {
      throw new PoolNotFoundError(poolId);
    }

    this.conn
      .prepare('DELETE FROM connection_pool_members WHERE pool_id = ? AND connection_id = ?')
      .run(poolId, connectionId);

    const nowIso = new Date().toISOString();
    this.conn
      .prepare('UPDATE connection_pools SET updated_at = ? WHERE id = ? AND organization_id = ?')
      .run(nowIso, poolId, orgId);
  }

  /**
   * Retrieves all members of the pool scoped to the organization.
   */
  getPoolMembers(orgId: string, poolId: string): ConnectionPoolMember[] {
    const pool = this.getPool(orgId, poolId);
    if (!pool) {
      throw new PoolNotFoundError(poolId);
    }

    const rows = this.conn
      .prepare(`
        SELECT m.pool_id, m.connection_id, m.created_at,
               c.status, c.name, c.phone_number
        FROM connection_pool_members m
        JOIN messaging_connections c ON c.id = m.connection_id
        WHERE m.pool_id = ? AND c.organization_id = ?
        ORDER BY m.created_at ASC, m.connection_id ASC
      `)
      .all(poolId, orgId) as Array<{
        pool_id: string;
        connection_id: string;
        created_at: string;
        status?: string;
        name?: string;
        phone_number?: string | null;
      }>;

    return rows.map((r) => ({
      poolId: r.pool_id,
      connectionId: r.connection_id,
      createdAt: new Date(r.created_at),
      status: r.status,
      name: r.name,
      phoneNumber: r.phone_number,
    }));
  }

  /**
   * Selects the next healthy ('connected') connection using stateful round-robin (cycling through members).
   * If a connection has status != 'connected', skips to the next one.
   * If no connected members exist in the pool, throws NoAvailableConnectionError.
   */
  selectNextConnection(orgId: string, poolId: string, excludeIds?: string[]): string {
    const pool = this.getPool(orgId, poolId);
    if (!pool) {
      throw new PoolNotFoundError(poolId);
    }

    const members = this.conn
      .prepare(`
        SELECT m.connection_id, c.status
        FROM connection_pool_members m
        JOIN messaging_connections c ON c.id = m.connection_id
        WHERE m.pool_id = ? AND c.organization_id = ?
        ORDER BY m.created_at ASC, m.connection_id ASC
      `)
      .all(poolId, orgId) as Array<{ connection_id: string; status: string }>;

    if (members.length === 0) {
      throw new NoAvailableConnectionError(poolId);
    }

    const excludeSet = new Set(excludeIds ?? []);
    const total = members.length;
    const stateKey = `${orgId}:${poolId}`;
    const currentCursor = this.roundRobinIndexes.get(stateKey) ?? 0;

    for (let i = 0; i < total; i++) {
      const candidateIndex = (currentCursor + i) % total;
      const candidate = members[candidateIndex];

      if (candidate && candidate.status === 'connected' && !excludeSet.has(candidate.connection_id)) {
        this.roundRobinIndexes.set(stateKey, (candidateIndex + 1) % total);
        return candidate.connection_id;
      }
    }

    throw new NoAvailableConnectionError(poolId);
  }

  /**
   * Distributes jobs across healthy pool members in round-robin sequence.
   */
  distributeJobs<T>(orgId: string, poolId: string, jobs: T[]): Array<{ connectionId: string; job: T }> {
    const pool = this.getPool(orgId, poolId);
    if (!pool) {
      throw new PoolNotFoundError(poolId);
    }

    if (jobs.length === 0) {
      return [];
    }

    return jobs.map((job) => ({
      connectionId: this.selectNextConnection(orgId, poolId),
      job,
    }));
  }

  /**
   * Resets the round-robin cursor for a pool (e.g. for testing or reconfiguration).
   */
  resetCursor(orgId: string, poolId: string): void {
    const stateKey = `${orgId}:${poolId}`;
    this.roundRobinIndexes.delete(stateKey);
    this.roundRobinIndexes.delete(poolId);
  }
}
