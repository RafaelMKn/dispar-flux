import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import { normalizePhoneNumber } from '@dispar-flux/domain';
import type { LidJidMappingRecord, ResolvedContactIdentifier } from '../types.js';

interface LidJidRow {
  id: string;
  organization_id: string;
  contact_id: string;
  jid: string | null;
  lid: string | null;
  normalized_phone: string | null;
  created_at: string;
  updated_at: string;
}

export class LidJidRepository {
  constructor(private readonly conn: DatabaseConnection) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS lid_jid_mappings (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        jid TEXT,
        lid TEXT,
        normalized_phone TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(organization_id, lid),
        UNIQUE(organization_id, jid)
      );
      CREATE INDEX IF NOT EXISTS idx_lid_jid_org_lid ON lid_jid_mappings(organization_id, lid);
      CREATE INDEX IF NOT EXISTS idx_lid_jid_org_jid ON lid_jid_mappings(organization_id, jid);
      CREATE INDEX IF NOT EXISTS idx_lid_jid_contact ON lid_jid_mappings(contact_id);
    `);
  }

  private mapRow(row: LidJidRow): LidJidMappingRecord {
    return {
      id: row.id,
      organizationId: row.organization_id,
      contactId: row.contact_id,
      jid: row.jid || undefined,
      lid: row.lid || undefined,
      normalizedPhone: row.normalized_phone || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Registers or updates a JID/LID association for a contact.
   * Enforces ADR 0039: JID and LID do not create distinct business identities.
   */
  registerMapping(params: {
    organizationId: string;
    contactId: string;
    jid?: string;
    lid?: string;
    normalizedPhone?: string;
  }): LidJidMappingRecord {
    const now = new Date().toISOString();
    const id = `map_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    // Check existing mapping by contactId or lid or jid
    let existing: LidJidRow | undefined;
    if (params.lid) {
      existing = this.conn
        .prepare('SELECT * FROM lid_jid_mappings WHERE organization_id = ? AND lid = ?')
        .get(params.organizationId, params.lid) as LidJidRow | undefined;
    }
    if (!existing && params.jid) {
      existing = this.conn
        .prepare('SELECT * FROM lid_jid_mappings WHERE organization_id = ? AND jid = ?')
        .get(params.organizationId, params.jid) as LidJidRow | undefined;
    }
    if (!existing) {
      existing = this.conn
        .prepare('SELECT * FROM lid_jid_mappings WHERE organization_id = ? AND contact_id = ?')
        .get(params.organizationId, params.contactId) as LidJidRow | undefined;
    }

    if (existing) {
      const mergedJid = params.jid || existing.jid;
      const mergedLid = params.lid || existing.lid;
      const mergedPhone = params.normalizedPhone || existing.normalized_phone;

      this.conn
        .prepare(`
          UPDATE lid_jid_mappings
          SET contact_id = ?, jid = ?, lid = ?, normalized_phone = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(params.contactId, mergedJid, mergedLid, mergedPhone, now, existing.id);

      const updated = this.conn
        .prepare('SELECT * FROM lid_jid_mappings WHERE id = ?')
        .get(existing.id) as unknown as LidJidRow;
      return this.mapRow(updated);
    }

    this.conn
      .prepare(`
        INSERT INTO lid_jid_mappings (
          id, organization_id, contact_id, jid, lid,
          normalized_phone, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        params.organizationId,
        params.contactId,
        params.jid || null,
        params.lid || null,
        params.normalizedPhone || null,
        now,
        now
      );

    const inserted = this.conn
      .prepare('SELECT * FROM lid_jid_mappings WHERE id = ?')
      .get(id) as unknown as LidJidRow;
    return this.mapRow(inserted);
  }

  /**
   * Resolves an incoming identifier (phone number, JID, or LID) to a Contact ID.
   */
  resolveIdentifier(
    organizationId: string,
    identifier: string
  ): ResolvedContactIdentifier | null {
    const trimmed = identifier.trim();

    // 1. Is it an LID? e.g. 1234567890@lid
    if (trimmed.endsWith('@lid') || trimmed.includes('@lid')) {
      const row = this.conn
        .prepare('SELECT * FROM lid_jid_mappings WHERE organization_id = ? AND lid = ?')
        .get(organizationId, trimmed) as LidJidRow | undefined;

      if (row) {
        return {
          contactId: row.contact_id,
          normalizedPhone: row.normalized_phone || '',
          jid: row.jid || undefined,
          lid: row.lid || undefined,
        };
      }
      return null;
    }

    // 2. Is it a JID? e.g. 5511999998888@s.whatsapp.net
    if (trimmed.includes('@s.whatsapp.net') || trimmed.includes('@c.us')) {
      const row = this.conn
        .prepare('SELECT * FROM lid_jid_mappings WHERE organization_id = ? AND jid = ?')
        .get(organizationId, trimmed) as LidJidRow | undefined;

      if (row) {
        return {
          contactId: row.contact_id,
          normalizedPhone: row.normalized_phone || '',
          jid: row.jid || undefined,
          lid: row.lid || undefined,
        };
      }

      // If not in mapping table, extract phone and query contacts table directly
      const phonePart = trimmed.split('@')[0] || '';
      try {
        const norm = normalizePhoneNumber(phonePart);
        const normalized = norm.isValid ? norm.digits : phonePart.replace(/\D/g, '');
        if (normalized) {
          const contactRow = this.conn
            .prepare('SELECT id, normalized_phone FROM contacts WHERE organization_id = ? AND normalized_phone = ?')
            .get(organizationId, normalized) as { id: string; normalized_phone: string } | undefined;

          if (contactRow) {
            // Auto-register JID mapping
            this.registerMapping({
              organizationId,
              contactId: contactRow.id,
              jid: trimmed,
              normalizedPhone: normalized,
            });
            return {
              contactId: contactRow.id,
              normalizedPhone: contactRow.normalized_phone,
              jid: trimmed,
            };
          }
        }
      } catch {
        // Not a standard phone number
      }
    }

    // 3. Raw phone number or digits
    try {
      const norm = normalizePhoneNumber(trimmed);
      const normalized = norm.isValid ? norm.digits : trimmed.replace(/\D/g, '');
      if (normalized) {
        const contactRow = this.conn
          .prepare('SELECT id, normalized_phone FROM contacts WHERE organization_id = ? AND normalized_phone = ?')
          .get(organizationId, normalized) as { id: string; normalized_phone: string } | undefined;

        if (contactRow) {
          const mappingRow = this.conn
            .prepare('SELECT * FROM lid_jid_mappings WHERE organization_id = ? AND contact_id = ?')
            .get(organizationId, contactRow.id) as LidJidRow | undefined;

          return {
            contactId: contactRow.id,
            normalizedPhone: contactRow.normalized_phone,
            jid: mappingRow?.jid || `${normalized}@s.whatsapp.net`,
            lid: mappingRow?.lid || undefined,
          };
        }
      }
    } catch {
      // Invalid phone format
    }

    return null;
  }

  findByContactId(organizationId: string, contactId: string): LidJidMappingRecord | null {
    const row = this.conn
      .prepare('SELECT * FROM lid_jid_mappings WHERE organization_id = ? AND contact_id = ?')
      .get(organizationId, contactId) as LidJidRow | undefined;
    return row ? this.mapRow(row) : null;
  }
}
