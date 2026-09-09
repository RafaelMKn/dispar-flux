import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type Base,
  type BaseMembership,
  type Contact,
  createBase as createDomainBase,
  createBaseMembership as createDomainMembership,
  InvariantViolationError,
} from '@dispar-flux/domain';
import { BaseNotFoundError, ContactNotFoundError, CrossTenantViolationError } from '../errors.js';
import { mapRowToContact, type ContactRow } from '../contacts/contact-service.js';

export interface BaseRow {
  id: string;
  organization_id: string;
  name: string;
  provenance: string;
  purpose: string;
  acquired_at: string;
  created_at: string;
  updated_at: string;
}

export interface BaseMembershipRow {
  id: string;
  base_id: string;
  contact_id: string;
  imported_fields: string;
  created_at: string;
  updated_at: string;
}

export interface CreateBaseInput {
  organizationId: string;
  name: string;
  provenance: string;
  purpose: string;
  acquiredAt?: Date;
}

export function mapRowToBase(row: BaseRow): Base {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    provenance: row.provenance,
    purpose: row.purpose,
    acquiredAt: new Date(row.acquired_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function mapRowToMembership(row: BaseMembershipRow): BaseMembership {
  let importedFields: Record<string, unknown> = {};
  try {
    importedFields = JSON.parse(row.imported_fields || '{}');
  } catch {
    importedFields = {};
  }

  return {
    id: row.id,
    baseId: row.base_id,
    contactId: row.contact_id,
    importedFields,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class BaseService {
  constructor(private readonly conn: DatabaseConnection) {}

  /**
   * Creates a new Base with mandatory provenance and purpose (ADR 0036).
   */
  createBase(input: CreateBaseInput): Base {
    const baseId = crypto.randomUUID();
    const domainBase = createDomainBase({
      id: baseId,
      organizationId: input.organizationId,
      name: input.name,
      provenance: input.provenance,
      purpose: input.purpose,
      acquiredAt: input.acquiredAt,
    });

    const now = domainBase.createdAt.toISOString();
    const acquiredAtStr = domainBase.acquiredAt.toISOString();

    this.conn
      .prepare(`
        INSERT INTO bases (
          id, organization_id, name, provenance, purpose,
          acquired_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        domainBase.id,
        domainBase.organizationId,
        domainBase.name,
        domainBase.provenance,
        domainBase.purpose,
        acquiredAtStr,
        now,
        now
      );

    return domainBase;
  }

  /**
   * Retrieves a Base by ID, optionally scoped to organizationId.
   */
  getBase(id: string, organizationId?: string): Base | null {
    let sql = 'SELECT * FROM bases WHERE id = ?';
    const params: string[] = [id];
    if (organizationId) {
      sql += ' AND organization_id = ?';
      params.push(organizationId);
    }
    const row = this.conn.prepare(sql).get(...params) as unknown as BaseRow | undefined;

    return row ? mapRowToBase(row) : null;
  }

  /**
   * Lists all bases for an organization.
   */
  listBases(organizationId: string): Base[] {
    const rows = this.conn
      .prepare('SELECT * FROM bases WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as unknown as BaseRow[];

    return rows.map(mapRowToBase);
  }

  /**
   * Deletes a Base and cascading memberships, optionally scoped to organizationId.
   */
  deleteBase(id: string, organizationId?: string): boolean {
    let sql = 'DELETE FROM bases WHERE id = ?';
    const params: string[] = [id];
    if (organizationId) {
      sql += ' AND organization_id = ?';
      params.push(organizationId);
    }
    const result = this.conn.prepare(sql).run(...params);
    return result.changes > 0;
  }

  /**
   * Adds or updates a contact membership in a base (ADR 0034 & ADR 0041).
   * Stores source-specific imported fields without overwriting canonical contact attributes.
   * Enforces that both base and contact belong to the same organization.
   */
  addMembership(
    baseId: string,
    contactId: string,
    importedFields?: Record<string, unknown>,
    organizationId?: string
  ): BaseMembership {
    // Validate base exists (and matches organizationId if provided)
    const base = this.getBase(baseId, organizationId);
    if (!base || (organizationId && base.organizationId !== organizationId)) {
      throw new BaseNotFoundError(baseId);
    }

    // Validate contact exists and belongs to the SAME organization
    const contactRow = this.conn
      .prepare('SELECT id, organization_id FROM contacts WHERE id = ?')
      .get(contactId) as { id: string; organization_id: string } | undefined;
    if (!contactRow) {
      throw new ContactNotFoundError(contactId);
    }

    if (contactRow.organization_id !== base.organizationId) {
      throw new CrossTenantViolationError(
        `Contact "${contactId}" belongs to organization "${contactRow.organization_id}", but base "${baseId}" belongs to "${base.organizationId}". Cross-tenant membership is forbidden.`
      );
    }

    const existing = this.conn
      .prepare('SELECT * FROM base_memberships WHERE base_id = ? AND contact_id = ?')
      .get(baseId, contactId) as unknown as BaseMembershipRow | undefined;

    const now = new Date().toISOString();

    if (existing) {
      // Merge source-specific fields into base_membership
      let currentFields: Record<string, unknown> = {};
      try {
        currentFields = JSON.parse(existing.imported_fields || '{}');
      } catch {
        currentFields = {};
      }

      const mergedFields = {
        ...currentFields,
        ...(importedFields ?? {}),
      };

      this.conn
        .prepare(`
          UPDATE base_memberships
          SET imported_fields = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(JSON.stringify(mergedFields), now, existing.id);

      return {
        id: existing.id,
        baseId,
        contactId,
        importedFields: mergedFields,
        createdAt: new Date(existing.created_at),
        updatedAt: new Date(now),
      };
    }

    const membershipId = crypto.randomUUID();
    const fieldsToStore = importedFields ? { ...importedFields } : {};

    this.conn
      .prepare(`
        INSERT INTO base_memberships (
          id, base_id, contact_id, imported_fields, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        membershipId,
        baseId,
        contactId,
        JSON.stringify(fieldsToStore),
        now,
        now
      );

    return {
      id: membershipId,
      baseId,
      contactId,
      importedFields: fieldsToStore,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * Retrieves a specific base membership.
   */
  getMembership(baseId: string, contactId: string): BaseMembership | null {
    const row = this.conn
      .prepare('SELECT * FROM base_memberships WHERE base_id = ? AND contact_id = ?')
      .get(baseId, contactId) as unknown as BaseMembershipRow | undefined;

    return row ? mapRowToMembership(row) : null;
  }

  /**
   * Lists all memberships in a base along with their canonical contact.
   * If organizationId is provided, validates base ownership first.
   */
  listMemberships(
    baseId: string,
    organizationId?: string
  ): Array<BaseMembership & { contact: Contact }> {
    if (organizationId) {
      const base = this.getBase(baseId, organizationId);
      if (!base) {
        throw new BaseNotFoundError(baseId);
      }
    }

    let sql = `
        SELECT
          bm.id as bm_id,
          bm.base_id,
          bm.contact_id,
          bm.imported_fields,
          bm.created_at as bm_created_at,
          bm.updated_at as bm_updated_at,
          c.id as c_id,
          c.organization_id,
          c.normalized_phone,
          c.name,
          c.custom_fields,
          c.notes,
          c.last_edited_by_member_id,
          c.last_edited_at,
          c.is_opted_out,
          c.created_at as c_created_at,
          c.updated_at as c_updated_at
        FROM base_memberships bm
        JOIN contacts c ON bm.contact_id = c.id
        WHERE bm.base_id = ?
    `;
    const params: string[] = [baseId];

    if (organizationId) {
      sql += ' AND c.organization_id = ?';
      params.push(organizationId);
    }

    sql += ' ORDER BY bm.created_at ASC';

    const rows = this.conn.prepare(sql).all(...params) as Record<string, unknown>[];

    return rows.map((r) => {
      let importedFields: Record<string, unknown> = {};
      try {
        importedFields = JSON.parse(String(r['imported_fields'] || '{}'));
      } catch {
        importedFields = {};
      }

      const contactRow: ContactRow = {
        id: String(r['c_id']),
        organization_id: String(r['organization_id']),
        normalized_phone: String(r['normalized_phone']),
        name: r['name'] ? String(r['name']) : null,
        custom_fields: String(r['custom_fields'] || '{}'),
        notes: r['notes'] ? String(r['notes']) : null,
        last_edited_by_member_id: r['last_edited_by_member_id'] ? String(r['last_edited_by_member_id']) : null,
        last_edited_at: r['last_edited_at'] ? String(r['last_edited_at']) : null,
        is_opted_out: Number(r['is_opted_out'] ?? 0),
        created_at: String(r['c_created_at']),
        updated_at: String(r['c_updated_at']),
      };

      return {
        id: String(r['bm_id']),
        baseId: String(r['base_id']),
        contactId: String(r['contact_id']),
        importedFields,
        createdAt: new Date(String(r['bm_created_at'])),
        updatedAt: new Date(String(r['bm_updated_at'])),
        contact: mapRowToContact(contactRow),
      };
    });
  }

  /**
   * Counts members in a base.
   */
  countMemberships(baseId: string, organizationId?: string): number {
    if (organizationId) {
      const base = this.getBase(baseId, organizationId);
      if (!base) {
        throw new BaseNotFoundError(baseId);
      }
    }
    const row = this.conn
      .prepare('SELECT COUNT(*) as count FROM base_memberships WHERE base_id = ?')
      .get(baseId) as { count: number };
    return row.count;
  }

  /**
   * Removes a contact from a base.
   */
  removeMembership(baseId: string, contactId: string, organizationId?: string): boolean {
    if (organizationId) {
      const base = this.getBase(baseId, organizationId);
      if (!base) {
        throw new BaseNotFoundError(baseId);
      }
    }
    const result = this.conn
      .prepare('DELETE FROM base_memberships WHERE base_id = ? AND contact_id = ?')
      .run(baseId, contactId);
    return result.changes > 0;
  }
}
