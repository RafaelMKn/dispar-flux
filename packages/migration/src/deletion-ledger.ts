import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseConnection } from '@dispar-flux/database';
import type { DatabaseSync } from 'node:sqlite';
import type { DeletionLedgerRecord } from './types.js';
import { sha256 } from './crypto.js';

export interface ReapplyLedgerResult {
  reappliedDeletionsCount: number;
  reappliedOptOutsCount: number;
}

/**
 * Re-applies the Deletion Ledger onto a restored database (ADR 0031).
 *
 * Ensures that any contact deletions or opt-outs that occurred after the backup was created
 * are faithfully re-applied to prevent resurrecting deleted contacts or sending to opted-out contacts.
 */
export function reapplyDeletionLedger(
  dbOrConn: DatabaseSync | DatabaseConnection,
  records: DeletionLedgerRecord[],
  options: { organizationId?: string } = {}
): ReapplyLedgerResult {
  if (!records || records.length === 0) {
    return { reappliedDeletionsCount: 0, reappliedOptOutsCount: 0 };
  }

  const rawDb = dbOrConn instanceof DatabaseConnection ? dbOrConn.db : dbOrConn;

  let reappliedDeletionsCount = 0;
  let reappliedOptOutsCount = 0;

  // Resolve default organizationId if not provided
  let orgId = options.organizationId;
  if (!orgId) {
    const orgRow = rawDb.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;
    orgId = orgRow?.id || 'org_default';
  }

  const findContactsStmt = rawDb.prepare(
    'SELECT id, organization_id, normalized_phone FROM contacts WHERE normalized_phone = ?'
  );
  const deleteContactStmt = rawDb.prepare('DELETE FROM contacts WHERE id = ?');
  const insertSuppressionStmt = rawDb.prepare(
    'INSERT OR IGNORE INTO suppression_keys (id, organization_id, hash_key, created_at) VALUES (?, ?, ?, ?)'
  );
  const markOptOutContactStmt = rawDb.prepare(
    'UPDATE contacts SET is_opted_out = 1, updated_at = ? WHERE normalized_phone = ?'
  );
  const insertOptOutStmt = rawDb.prepare(
    'INSERT OR IGNORE INTO opt_outs (id, organization_id, normalized_phone, contact_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  rawDb.exec('BEGIN IMMEDIATE;');
  try {
    for (const record of records) {
      const now = new Date().toISOString();
      const phone = record.normalizedPhone.trim();

      if (record.type === 'contact_deletion') {
        const matchingContacts = findContactsStmt.all(phone) as Array<{
          id: string;
          organization_id: string;
          normalized_phone: string;
        }>;

        for (const contact of matchingContacts) {
          deleteContactStmt.run(contact.id);
          reappliedDeletionsCount++;
        }

        // Add to suppression keys so contact cannot be inadvertently recontacted or reimported
        const suppressionHash = sha256(`dispar_flux_suppression:${phone}`);
        insertSuppressionStmt.run(crypto.randomUUID(), orgId, suppressionHash, record.timestamp || now);

        // If no contacts were in DB, still increment deletions if record was targeted
        if (matchingContacts.length === 0) {
          reappliedDeletionsCount++;
        }
      } else if (record.type === 'opt_out') {
        markOptOutContactStmt.run(now, phone);

        const contact = findContactsStmt.get(phone) as { id: string } | undefined;
        insertOptOutStmt.run(
          record.id || crypto.randomUUID(),
          orgId,
          phone,
          contact?.id ?? null,
          record.reason || 'Opt-out re-applied via disaster recovery Deletion Ledger (ADR 0031)',
          record.timestamp || now
        );
        reappliedOptOutsCount++;
      }
    }

    rawDb.exec('COMMIT;');
  } catch (err) {
    try {
      rawDb.exec('ROLLBACK;');
    } catch {
      // ignore
    }
    throw err;
  }

  return { reappliedDeletionsCount, reappliedOptOutsCount };
}

/**
 * Loads deletion ledger records from a JSON file.
 */
export function loadDeletionLedger(filePath: string): DeletionLedgerRecord[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as DeletionLedgerRecord[];
}

/**
 * Saves deletion ledger records to a JSON file.
 */
export function saveDeletionLedger(records: DeletionLedgerRecord[], filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf8');
}
