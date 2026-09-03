import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type Contact,
  normalizePhoneNumber,
  InvalidPhoneNumberError,
} from '@dispar-flux/domain';
import { ContactNotFoundError } from '../errors.js';

export interface ContactRow {
  id: string;
  organization_id: string;
  normalized_phone: string;
  name: string | null;
  custom_fields: string;
  notes: string | null;
  last_edited_by_member_id: string | null;
  last_edited_at: string | null;
  is_opted_out: number;
  created_at: string;
  updated_at: string;
}

export interface FindOrCreateContactInput {
  phone: string;
  name?: string;
  defaultCountryCode?: string;
}

export interface UpdateCanonicalProfileInput {
  name?: string;
  notes?: string;
  customFields?: Record<string, string>;
}

export function mapRowToContact(row: ContactRow): Contact {
  let customFields: Record<string, string> = {};
  try {
    customFields = JSON.parse(row.custom_fields || '{}');
  } catch {
    customFields = {};
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    normalizedPhone: row.normalized_phone,
    name: row.name ?? undefined,
    canonicalProfile: {
      customFields,
      notes: row.notes ?? undefined,
      lastEditedByMemberId: row.last_edited_by_member_id ?? undefined,
      lastEditedAt: row.last_edited_at ? new Date(row.last_edited_at) : undefined,
    },
    isOptedOut: row.is_opted_out === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class ContactService {
  constructor(private readonly conn: DatabaseConnection) {}

  /**
   * Finds a canonical contact by ID.
   */
  findById(id: string): Contact | null {
    const row = this.conn
      .prepare('SELECT * FROM contacts WHERE id = ?')
      .get(id) as unknown as ContactRow | undefined;

    return row ? mapRowToContact(row) : null;
  }

  /**
   * Finds a canonical contact by normalized phone in the given organization.
   */
  findByPhone(organizationId: string, phone: string, defaultCountryCode = '55'): Contact | null {
    const normalized = normalizePhoneNumber(phone, defaultCountryCode);
    const targetPhone = normalized.isValid ? normalized.e164 : phone;

    const row = this.conn
      .prepare('SELECT * FROM contacts WHERE organization_id = ? AND normalized_phone = ?')
      .get(organizationId, targetPhone) as unknown as ContactRow | undefined;

    return row ? mapRowToContact(row) : null;
  }

  /**
   * Deduplicates contacts by normalized E.164 phone across the entire organization (ADR 0034).
   *
   * If the contact already exists, it is returned without overwriting canonical attributes (ADR 0041).
   * If it does not exist, a new canonical contact is created.
   */
  findOrCreateContact(
    organizationId: string,
    input: FindOrCreateContactInput
  ): { contact: Contact; isNew: boolean } {
    const normalized = normalizePhoneNumber(input.phone, input.defaultCountryCode ?? '55');
    if (!normalized.isValid) {
      throw new InvalidPhoneNumberError(
        normalized.error ?? `Invalid phone number: ${input.phone}`,
        input.phone
      );
    }

    const normalizedPhone = normalized.e164;

    // Check if canonical contact already exists for this organization & normalized phone
    const existing = this.conn
      .prepare('SELECT * FROM contacts WHERE organization_id = ? AND normalized_phone = ?')
      .get(organizationId, normalizedPhone) as unknown as ContactRow | undefined;

    if (existing) {
      return {
        contact: mapRowToContact(existing),
        isNew: false,
      };
    }

    // Check if phone has an active opt-out in the organization
    const activeOptOut = this.conn
      .prepare('SELECT id FROM opt_outs WHERE organization_id = ? AND normalized_phone = ? AND reauthorized_at IS NULL')
      .get(organizationId, normalizedPhone);

    const isOptedOut = activeOptOut ? 1 : 0;
    const now = new Date().toISOString();
    const contactId = crypto.randomUUID();
    const cleanName = input.name ? input.name.trim() : null;

    this.conn
      .prepare(`
        INSERT INTO contacts (
          id, organization_id, normalized_phone, name,
          custom_fields, notes, is_opted_out, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        contactId,
        organizationId,
        normalizedPhone,
        cleanName,
        '{}',
        null,
        isOptedOut,
        now,
        now
      );

    const created = this.findById(contactId);
    if (!created) {
      throw new Error(`Failed to retrieve newly created contact ${contactId}`);
    }

    return {
      contact: created,
      isNew: true,
    };
  }

  /**
   * Deliberately edits canonical contact profile (ADR 0041).
   * Records member attribution and edit timestamp.
   */
  updateCanonicalProfile(
    contactId: string,
    memberId: string,
    updates: UpdateCanonicalProfileInput
  ): Contact {
    const current = this.findById(contactId);
    if (!current) {
      throw new ContactNotFoundError(contactId);
    }

    const mergedCustomFields = {
      ...current.canonicalProfile.customFields,
      ...(updates.customFields ?? {}),
    };

    const newName = updates.name !== undefined ? updates.name.trim() : current.name;
    const newNotes = updates.notes !== undefined ? updates.notes.trim() : current.canonicalProfile.notes;
    const now = new Date().toISOString();

    this.conn
      .prepare(`
        UPDATE contacts
        SET name = ?, notes = ?, custom_fields = ?, last_edited_by_member_id = ?, last_edited_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        newName ?? null,
        newNotes ?? null,
        JSON.stringify(mergedCustomFields),
        memberId,
        now,
        now,
        contactId
      );

    return this.findById(contactId)!;
  }

  /**
   * Lists contacts for an organization with pagination.
   */
  listContacts(
    organizationId: string,
    options: { limit?: number; offset?: number } = {}
  ): { contacts: Contact[]; total: number } {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const countRow = this.conn
      .prepare('SELECT COUNT(*) as count FROM contacts WHERE organization_id = ?')
      .get(organizationId) as { count: number };

    const rows = this.conn
      .prepare(
        'SELECT * FROM contacts WHERE organization_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      )
      .all(organizationId, limit, offset) as unknown as ContactRow[];

    return {
      contacts: rows.map(mapRowToContact),
      total: countRow.count,
    };
  }
}
