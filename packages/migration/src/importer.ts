import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseConnection } from '@dispar-flux/database';
import { normalizePhoneNumber } from '@dispar-flux/domain';
import {
  MigrationError,
  ManifestValidationError,
  TargetNotCleanError,
} from './errors.js';
import { sha256, sha256File } from './crypto.js';
import { unpackToDirectory } from './tar.js';
import type {
  MigrationManifest,
  ImportMigrationOptions,
  ImportResult,
  ReconciliationReport,
  SourceCounts,
  TargetCounts,
} from './types.js';

export interface ValidationResult {
  valid: boolean;
  manifest: MigrationManifest;
  packageDir: string;
}

/**
 * Validates a Migration Package's manifest, file checksums, entity counts,
 * and verifies that no sensitive credentials or keys are included (ADR 0008, 0014, 0017).
 */
export function validateMigrationPackage(packagePathOrDir: string): ValidationResult {
  let packageDir = packagePathOrDir;
  let isTempDir = false;

  if (!fs.existsSync(packagePathOrDir)) {
    throw new ManifestValidationError(`Migration package path not found: ${packagePathOrDir}`);
  }

  const stat = fs.statSync(packagePathOrDir);
  if (stat.isFile()) {
    const tempDir = path.join(
      process.env.TEMP || process.env.TMP || '/tmp',
      `df-mig-val-${crypto.randomUUID().slice(0, 8)}`
    );
    fs.mkdirSync(tempDir, { recursive: true });
    const tarBuffer = fs.readFileSync(packagePathOrDir);
    unpackToDirectory(tarBuffer, tempDir);
    packageDir = tempDir;
    isTempDir = true;
  }

  try {
    const manifestPath = path.join(packageDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new ManifestValidationError('Migration package is missing manifest.json');
    }

    let manifest: MigrationManifest;
    try {
      const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
      manifest = JSON.parse(manifestRaw) as MigrationManifest;
    } catch (err) {
      throw new ManifestValidationError('Failed to parse manifest.json: invalid JSON format', { cause: err });
    }

    // 1. Schema version validation
    if (manifest.schemaVersion !== 1) {
      throw new ManifestValidationError(
        `Unsupported migration manifest schema version: ${manifest.schemaVersion}. Expected schema version 1.`
      );
    }

    // 2. ADR 0008: Prohibit credentials and secret keys
    for (const file of manifest.files || []) {
      const normalizedPath = file.path.toLowerCase().replace(/\\/g, '/');
      if (
        normalizedPath.includes('wa-auth') ||
        normalizedPath.includes('credentials') ||
        normalizedPath.includes('.key') ||
        normalizedPath.includes('.env') ||
        normalizedPath.includes('secret')
      ) {
        throw new ManifestValidationError(
          `Security violation (ADR 0008): Migration package contains prohibited credentials file: "${file.path}". Credentials must not cross the migration package.`
        );
      }
    }

    // 3. File checksums and size validation
    for (const file of manifest.files || []) {
      const fullPath = path.join(packageDir, file.path);
      if (!fs.existsSync(fullPath)) {
        throw new ManifestValidationError(`Manifest references file that does not exist in package: "${file.path}"`);
      }

      const fileStat = fs.statSync(fullPath);
      if (fileStat.size !== file.size) {
        throw new ManifestValidationError(
          `File size mismatch for "${file.path}": expected ${file.size} bytes, found ${fileStat.size} bytes`
        );
      }

      const calculatedSha = sha256File(fullPath);
      if (calculatedSha.toLowerCase() !== file.sha256.toLowerCase()) {
        throw new ManifestValidationError(
          `SHA-256 checksum verification failed for "${file.path}". Package may be corrupted or tampered.`
        );
      }
    }

    // 4. Entity count validation against legacy SQLite snapshot
    const legacyDbPath = path.join(packageDir, 'legacy.sqlite');
    if (!fs.existsSync(legacyDbPath)) {
      throw new ManifestValidationError('Migration package is missing legacy SQLite database ("legacy.sqlite")');
    }

    const legacyDb = new DatabaseSync(legacyDbPath, { readOnly: true });
    try {
      const checkCount = (table: string, expectedCount?: number) => {
        if (expectedCount === undefined) return;
        try {
          const res = legacyDb.prepare(`SELECT count(*) as cnt FROM ${table}`).get() as { cnt: number };
          const actual = Number(res?.cnt || 0);
          if (actual !== expectedCount) {
            throw new ManifestValidationError(
              `Entity count mismatch for table "${table}": manifest reports ${expectedCount}, but database contains ${actual}`
            );
          }
        } catch (err) {
          if (err instanceof ManifestValidationError) throw err;
          if (expectedCount > 0) {
            throw new ManifestValidationError(
              `Entity count mismatch: table "${table}" does not exist in legacy database, but manifest reports ${expectedCount}`
            );
          }
        }
      };

      const counts = manifest.entityCounts || {};
      checkCount('contact_lists', counts.lists);
      checkCount('contacts', counts.contacts);
      checkCount('campaigns', counts.campaigns);
      checkCount('campaign_jobs', counts.campaignJobs);
      checkCount('opt_outs', counts.optOuts);
      checkCount('chats', counts.chats);
      checkCount('messages', counts.messages);
      checkCount('crm_stages', counts.stages);
      checkCount('crm_leads', counts.leads);
    } finally {
      legacyDb.close();
    }

    return { valid: true, manifest, packageDir };
  } catch (err) {
    if (isTempDir) {
      try {
        fs.rmSync(packageDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

/**
 * Checks whether the target installation database is completely clean/uninitialized (ADR 0014).
 * Throws TargetNotCleanError if existing contacts, campaigns, messages, or bases are found.
 */
export function ensureTargetClean(targetDb: DatabaseSync): void {
  const tables = ['contacts', 'campaigns', 'messages', 'bases', 'conversations', 'leads'];

  for (const table of tables) {
    try {
      const res = targetDb.prepare(`SELECT count(*) as cnt FROM ${table}`).get() as { cnt: number };
      const count = Number(res?.cnt || 0);
      if (count > 0) {
        throw new TargetNotCleanError(
          `Target installation is not clean or uninitialized. Found ${count} existing records in table "${table}". Per ADR 0014, migration can only be imported into a clean database.`
        );
      }
    } catch (err) {
      if (err instanceof TargetNotCleanError) throw err;
    }
  }
}

/**
 * Imports a Migration Package from the legacy desktop application into a clean Dispar Flux installation.
 * (ADRs 0008, 0014, 0017, 0028, 0034, 0036, 0041, 0060).
 */
export function importMigrationPackage(options: ImportMigrationOptions): ImportResult {
  const targetDb = options.targetDb instanceof DatabaseConnection ? options.targetDb.db : options.targetDb;

  ensureTargetClean(targetDb);

  let packageDir = options.packagePath;
  let isTempDir = false;

  const stat = fs.statSync(options.packagePath);
  if (stat.isFile()) {
    const tempDir = path.join(
      process.env.TEMP || process.env.TMP || '/tmp',
      `df-mig-run-${crypto.randomUUID().slice(0, 8)}`
    );
    fs.mkdirSync(tempDir, { recursive: true });
    unpackToDirectory(fs.readFileSync(options.packagePath), tempDir);
    packageDir = tempDir;
    isTempDir = true;
  }

  let manifest: MigrationManifest;
  try {
    if (!options.skipChecksumValidation) {
      const val = validateMigrationPackage(packageDir);
      manifest = val.manifest;
    } else {
      const raw = fs.readFileSync(path.join(packageDir, 'manifest.json'), 'utf8');
      manifest = JSON.parse(raw) as MigrationManifest;
    }

    const legacyDbPath = path.join(packageDir, 'legacy.sqlite');
    const legacyDb = new DatabaseSync(legacyDbPath, { readOnly: true });

    try {
      return executeImport({
        targetDb,
        legacyDb,
        packageDir,
        manifest,
        options,
      });
    } finally {
      legacyDb.close();
    }
  } finally {
    if (isTempDir) {
      try {
        fs.rmSync(packageDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

export class MigrationImporter {
  static importPackage(options: ImportMigrationOptions): ImportResult {
    return importMigrationPackage(options);
  }
}

interface InternalImportContext {
  targetDb: DatabaseSync;
  legacyDb: DatabaseSync;
  packageDir: string;
  manifest: MigrationManifest;
  options: ImportMigrationOptions;
}

function executeImport(ctx: InternalImportContext): ImportResult {
  const { targetDb, legacyDb, packageDir, manifest, options } = ctx;
  const now = new Date().toISOString();
  const discrepancies: string[] = [];
  const mediaIdMapping: Record<string, string> = {};

  const storageDir = options.storageDir || path.join(process.cwd(), 'data', 'media');
  fs.mkdirSync(storageDir, { recursive: true });

  let organizationId = options.organizationId;

  targetDb.exec('BEGIN IMMEDIATE;');
  try {
    // 1. Resolve or create target Organization
    if (!organizationId) {
      const existingOrg = targetDb.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;
      if (existingOrg) {
        organizationId = existingOrg.id;
      } else {
        organizationId = crypto.randomUUID();
        const orgName = options.organizationName || 'Organiza??o Principal';
        const tz = manifest.suggestedOperationalTimezone || 'America/Sao_Paulo';
        targetDb.prepare(`
          INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(organizationId, orgName, tz, now, now);
      }
    }

    // 2. Create default Messaging Connection (ADR 0002, 0005, 0008)
    let connectionId: string = crypto.randomUUID();
    const existingConn = targetDb.prepare('SELECT id FROM messaging_connections WHERE organization_id = ? LIMIT 1').get(organizationId) as { id: string } | undefined;
    if (existingConn) {
      connectionId = existingConn.id;
    } else {
      targetDb.prepare(`
        INSERT INTO messaging_connections (id, organization_id, name, provider, status, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(connectionId, organizationId, 'WhatsApp Principal', 'baileys', 'disconnected', 1, now, now);
    }

    // 3. Migrate Contact Lists -> Bases (ADR 0036)
    const listIdToBaseId = new Map<string, string>();
    let legacyLists: Array<{ id: string; name: string; created_at: number }> = [];
    try {
      legacyLists = legacyDb.prepare('SELECT id, name, created_at FROM contact_lists').all() as any;
    } catch {
      legacyLists = [];
    }

    const insertBaseStmt = targetDb.prepare(`
      INSERT INTO bases (id, organization_id, name, provenance, purpose, acquired_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const list of legacyLists) {
      const baseId = list.id;
      listIdToBaseId.set(list.id, baseId);
      const acquiredAt = new Date(list.created_at || Date.now()).toISOString();

      insertBaseStmt.run(
        baseId,
        organizationId,
        list.name,
        `Desktop Migration (Lista: ${list.name})`,
        'Migra??o do Aplicativo Legado',
        acquiredAt,
        acquiredAt,
        now
      );
    }

    // 4. Collect legacy opt_outs
    const legacyOptOutPhones = new Set<string>();
    try {
      const optRows = legacyDb.prepare('SELECT phone_e164 FROM opt_outs').all() as Array<{ phone_e164: string }>;
      for (const r of optRows) {
        const norm = normalizePhoneNumber(r.phone_e164, '55');
        legacyOptOutPhones.add(norm.isValid ? norm.e164 : r.phone_e164.trim());
      }
    } catch {
      // opt_outs table might be empty
    }

    // 5. Consolidate legacy contacts by normalized phone number into single canonical Contacts with BaseMemberships (ADR 0034)
    let legacyContacts: Array<{
      id: string;
      list_id: string;
      name?: string;
      phone_e164: string;
      jid?: string;
      extra_json?: string;
      wa_valid?: number;
      opt_out?: number;
      created_at: number;
    }> = [];
    try {
      legacyContacts = legacyDb.prepare('SELECT * FROM contacts ORDER BY created_at ASC').all() as any;
    } catch {
      legacyContacts = [];
    }

    interface LegacyContactGroup {
      canonicalPhone: string;
      rows: typeof legacyContacts;
    }
    const phoneGroups = new Map<string, LegacyContactGroup>();

    for (const row of legacyContacts) {
      const norm = normalizePhoneNumber(row.phone_e164, '55');
      const canonicalPhone = norm.isValid ? norm.e164 : row.phone_e164.trim();
      let group = phoneGroups.get(canonicalPhone);
      if (!group) {
        group = { canonicalPhone, rows: [] };
        phoneGroups.set(canonicalPhone, group);
      }
      group.rows.push(row);
    }

    const legacyContactIdToCanonicalId = new Map<string, string>();
    const phoneToCanonicalContactId = new Map<string, string>();

    const insertContactStmt = targetDb.prepare(`
      INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOptOutStmt = targetDb.prepare(`
      INSERT OR IGNORE INTO opt_outs (id, organization_id, normalized_phone, contact_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertBaseMembershipStmt = targetDb.prepare(`
      INSERT INTO base_memberships (id, base_id, contact_id, imported_fields, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let targetCanonicalContactsCount = 0;
    let targetBaseMembershipsCount = 0;
    let targetOptOutsCount = 0;

    for (const [canonicalPhone, group] of phoneGroups.entries()) {
      const canonicalId = crypto.randomUUID();
      phoneToCanonicalContactId.set(canonicalPhone, canonicalId);

      let canonicalName: string | undefined;
      for (const r of group.rows) {
        if (r.name && r.name.trim()) {
          canonicalName = r.name.trim();
          break;
        }
      }

      const isOptedOut = group.rows.some((r) => r.opt_out === 1) || legacyOptOutPhones.has(canonicalPhone);
      const earliestCreatedAt = new Date(Math.min(...group.rows.map((r) => r.created_at || Date.now()))).toISOString();

      insertContactStmt.run(
        canonicalId,
        organizationId,
        canonicalPhone,
        canonicalName ?? null,
        '{}',
        isOptedOut ? 1 : 0,
        earliestCreatedAt,
        now
      );
      targetCanonicalContactsCount++;

      if (isOptedOut) {
        insertOptOutStmt.run(
          crypto.randomUUID(),
          organizationId,
          canonicalPhone,
          canonicalId,
          'Migrado do aplicativo legado (ADR 0040)',
          earliestCreatedAt
        );
        targetOptOutsCount++;
      }

      const seenBasesForContact = new Set<string>();

      for (const r of group.rows) {
        legacyContactIdToCanonicalId.set(r.id, canonicalId);
        const baseId = listIdToBaseId.get(r.list_id);
        if (!baseId) continue;

        if (seenBasesForContact.has(baseId)) {
          continue;
        }
        seenBasesForContact.add(baseId);

        let importedFields: Record<string, unknown> = {};
        if (r.extra_json) {
          try {
            importedFields = JSON.parse(r.extra_json);
          } catch {
            importedFields = { rawExtra: r.extra_json };
          }
        }
        importedFields['_legacyContactId'] = r.id;
        if (r.name && r.name !== canonicalName) {
          importedFields['_legacyName'] = r.name;
        }

        const memberCreatedAt = new Date(r.created_at || Date.now()).toISOString();
        insertBaseMembershipStmt.run(
          crypto.randomUUID(),
          baseId,
          canonicalId,
          JSON.stringify(importedFields),
          memberCreatedAt,
          now
        );
        targetBaseMembershipsCount++;
      }
    }

    // Insert standalone opt-outs (opt_outs without an existing contact record)
    for (const optPhone of legacyOptOutPhones) {
      if (!phoneToCanonicalContactId.has(optPhone)) {
        insertOptOutStmt.run(
          crypto.randomUUID(),
          organizationId,
          optPhone,
          null,
          'Migrado do aplicativo legado (ADR 0040)',
          now
        );
        targetOptOutsCount++;
      }
    }

    if (legacyContacts.length > targetCanonicalContactsCount) {
      discrepancies.push(
        `Consolidated ${legacyContacts.length} legacy contact rows into ${targetCanonicalContactsCount} canonical contacts by normalized phone number (ADR 0034).`
      );
    }

    // 6. Migrate Campaigns & Campaign Jobs
    let legacyCampaigns: Array<{
      id: string;
      name: string;
      list_id: string;
      mode: string;
      config_json: string;
      delay_min_ms: number;
      delay_max_ms: number;
      rest_every_n: number;
      rest_duration_ms: number;
      daily_cap: number;
      status: string;
      created_at: number;
    }> = [];
    try {
      legacyCampaigns = legacyDb.prepare('SELECT * FROM campaigns').all() as any;
    } catch {
      legacyCampaigns = [];
    }

    const insertCampaignStmt = targetDb.prepare(`
      INSERT INTO campaigns (
        id, organization_id, connection_id, base_id, name, status, message_template,
        pacing_interval_seconds, daily_limit, confirmed_responsibility,
        snapshot_total, sent_count, failed_count, unknown_count, paused_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let runningCampaignsPausedCount = 0;

    for (const camp of legacyCampaigns) {
      const baseId = listIdToBaseId.get(camp.list_id) ?? null;

      let messageTemplate = camp.name;
      if (camp.config_json) {
        try {
          const cfg = JSON.parse(camp.config_json);
          messageTemplate = cfg.message || cfg.text || cfg.template || camp.name;
        } catch {
          messageTemplate = camp.config_json;
        }
      }

      const pacingInterval = Math.max(15, Math.round((camp.delay_min_ms || 30000) / 1000));
      const dailyLimit = Math.min(1000, Math.max(1, camp.daily_cap || 100));

      let targetStatus: 'draft' | 'running' | 'paused' | 'completed' | 'canceled' = 'draft';
      let pausedAt: string | null = null;

      if (camp.status === 'running' || camp.status === 'paused') {
        targetStatus = 'paused';
        pausedAt = now;
        if (camp.status === 'running') {
          runningCampaignsPausedCount++;
        }
      } else if (camp.status === 'completed') {
        targetStatus = 'completed';
      } else if (camp.status === 'canceled') {
        targetStatus = 'canceled';
      }

      const campCreatedAt = new Date(camp.created_at || Date.now()).toISOString();

      insertCampaignStmt.run(
        camp.id,
        organizationId,
        connectionId,
        baseId,
        camp.name,
        targetStatus,
        messageTemplate,
        pacingInterval,
        dailyLimit,
        1,
        0,
        0,
        0,
        0,
        pausedAt,
        campCreatedAt,
        now
      );
    }

    if (runningCampaignsPausedCount > 0) {
      discrepancies.push(
        `Preserved ${runningCampaignsPausedCount} running campaigns as paused without auto-resuming them (ADR 0014).`
      );
    }

    // 7. Migrate Campaign Jobs (ADR 0014, ADR 0028)
    let legacyJobs: Array<{
      id: string;
      campaign_id: string;
      contact_id: string;
      rendered_text?: string;
      status: string;
      attempts?: number;
      error?: string;
      wa_message_id?: string;
      sent_at?: number;
    }> = [];
    try {
      legacyJobs = legacyDb.prepare('SELECT * FROM campaign_jobs').all() as any;
    } catch {
      legacyJobs = [];
    }

    const insertJobStmt = targetDb.prepare(`
      INSERT INTO campaign_jobs (
        id, campaign_id, contact_id, normalized_phone, rendered_message, status, sent_at, error_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inFlightJobsCount = 0;
    let targetUnknownJobsCount = 0;
    const campaignCounts = new Map<string, { total: number; sent: number; failed: number; unknown: number }>();

    for (const job of legacyJobs) {
      const canonicalContactId = legacyContactIdToCanonicalId.get(job.contact_id);
      if (!canonicalContactId) continue;

      const contactRow = targetDb.prepare('SELECT normalized_phone FROM contacts WHERE id = ?').get(canonicalContactId) as { normalized_phone: string } | undefined;
      const phone = contactRow?.normalized_phone || '';

      let jobStatus: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' = 'pending';

      if (job.status === 'sending') {
        jobStatus = 'unknown';
        inFlightJobsCount++;
        targetUnknownJobsCount++;
      } else if (job.status === 'sent') {
        jobStatus = 'sent';
      } else if (job.status === 'failed' || job.status === 'skipped') {
        jobStatus = 'failed';
      } else {
        jobStatus = 'pending';
      }

      const sentAt = job.sent_at ? new Date(job.sent_at).toISOString() : null;

      insertJobStmt.run(
        job.id,
        job.campaign_id,
        canonicalContactId,
        phone,
        job.rendered_text || '',
        jobStatus,
        sentAt,
        job.error ?? null,
        now,
        now
      );

      let cCounts = campaignCounts.get(job.campaign_id);
      if (!cCounts) {
        cCounts = { total: 0, sent: 0, failed: 0, unknown: 0 };
        campaignCounts.set(job.campaign_id, cCounts);
      }
      cCounts.total++;
      if (jobStatus === 'sent') cCounts.sent++;
      if (jobStatus === 'failed') cCounts.failed++;
      if (jobStatus === 'unknown') cCounts.unknown++;
    }

    if (inFlightJobsCount > 0) {
      discrepancies.push(
        `Preserved ${inFlightJobsCount} interrupted/in-flight jobs as 'unknown' (Envio Incerto, ADR 0028).`
      );
    }

    const updateCampCountersStmt = targetDb.prepare(`
      UPDATE campaigns
      SET snapshot_total = ?, sent_count = ?, failed_count = ?, unknown_count = ?
      WHERE id = ?
    `);
    for (const [campId, counts] of campaignCounts.entries()) {
      updateCampCountersStmt.run(counts.total, counts.sent, counts.failed, counts.unknown, campId);
    }

    // 8. Migrate Chats -> Conversations (ADR 0039)
    let legacyChats: Array<{
      jid: string;
      name?: string;
      last_message?: string;
      last_ts?: number;
      unread?: number;
      avatar_path?: string;
      avatar_ts?: number;
      is_lead?: number;
      synced_from?: number;
      synced_full?: number;
      lid?: string;
    }> = [];
    try {
      legacyChats = legacyDb.prepare('SELECT * FROM chats').all() as any;
    } catch {
      legacyChats = [];
    }

    const jidToConversationId = new Map<string, string>();
    const insertConvStmt = targetDb.prepare(`
      INSERT INTO conversations (id, organization_id, connection_id, contact_id, unread_count, last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const chat of legacyChats) {
      const rawPhone = chat.jid.split('@')[0] || '';
      const norm = normalizePhoneNumber(rawPhone, '55');
      const phone = norm.isValid ? norm.e164 : `+${rawPhone}`;

      let contactId = phoneToCanonicalContactId.get(phone);
      if (!contactId) {
        contactId = crypto.randomUUID();
        insertContactStmt.run(contactId, organizationId, phone, chat.name ?? null, '{}', 0, now, now);
        phoneToCanonicalContactId.set(phone, contactId);
        targetCanonicalContactsCount++;
      }

      const convId = crypto.randomUUID();
      jidToConversationId.set(chat.jid, convId);
      const lastMsgAt = chat.last_ts ? new Date(chat.last_ts).toISOString() : null;

      insertConvStmt.run(
        convId,
        organizationId,
        connectionId,
        contactId,
        chat.unread || 0,
        lastMsgAt,
        lastMsgAt || now,
        now
      );
    }

    // 9. Migrate Messages and Rewrite Media References to Opaque Storage IDs
    let legacyMessages: Array<{
      id: string;
      chat_jid: string;
      direction: string;
      body?: string;
      ts: number;
      wa_ts?: number;
      wa_message_id?: string;
      status?: string;
      media_kind?: string;
      media_path?: string;
      media_mime?: string;
      media_name?: string;
      media_size?: number;
      media_seconds?: number;
      media_ptt?: number;
      media_state?: string;
      raw_proto?: string;
    }> = [];
    try {
      legacyMessages = legacyDb.prepare('SELECT * FROM messages').all() as any;
    } catch {
      legacyMessages = [];
    }

    const insertMsgStmt = targetDb.prepare(`
      INSERT INTO messages (
        id, conversation_id, direction, type, kind, content, media_url, media_type, external_id, status, sent_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let mediaFilesImportedCount = 0;

    for (const msg of legacyMessages) {
      let convId = jidToConversationId.get(msg.chat_jid);
      if (!convId) {
        const rawPhone = msg.chat_jid.split('@')[0] || '';
        const norm = normalizePhoneNumber(rawPhone, '55');
        const phone = norm.isValid ? norm.e164 : `+${rawPhone}`;
        let contactId = phoneToCanonicalContactId.get(phone);
        if (!contactId) {
          contactId = crypto.randomUUID();
          insertContactStmt.run(contactId, organizationId, phone, null, '{}', 0, now, now);
          phoneToCanonicalContactId.set(phone, contactId);
          targetCanonicalContactsCount++;
        }
        convId = crypto.randomUUID();
        jidToConversationId.set(msg.chat_jid, convId);
        insertConvStmt.run(convId, organizationId, connectionId, contactId, 0, null, now, now);
      }

      let mediaUrl: string | null = null;
      let mediaType: string | null = null;

      if (msg.media_path) {
        let opaqueId = mediaIdMapping[msg.media_path];
        if (!opaqueId) {
          opaqueId = `storage_${crypto.randomUUID().replace(/-/g, '')}`;
          mediaIdMapping[msg.media_path] = opaqueId;
        }

        mediaUrl = `storage://${opaqueId}`;
        mediaType = msg.media_mime || msg.media_kind || 'application/octet-stream';

        const candidates = [
          path.join(packageDir, msg.media_path),
          path.join(packageDir, 'media', path.basename(msg.media_path)),
          path.join(packageDir, path.basename(msg.media_path)),
        ];

        let foundSourcePath: string | undefined;
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            foundSourcePath = candidate;
            break;
          }
        }

        if (foundSourcePath) {
          const targetMediaPath = path.join(storageDir, opaqueId);
          if (!fs.existsSync(targetMediaPath)) {
            fs.copyFileSync(foundSourcePath, targetMediaPath);
            mediaFilesImportedCount++;
          }
        }
      }

      const direction: 'inbound' | 'outbound' = msg.direction === 'in' ? 'inbound' : 'outbound';
      const type: 'manual' | 'automated' = 'manual';
      const kind: 'inbound' | 'manual' | 'automated' = direction === 'inbound' ? 'inbound' : 'manual';

      let msgStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' = 'sent';
      if (msg.status === 'delivered') msgStatus = 'delivered';
      else if (msg.status === 'read') msgStatus = 'read';
      else if (msg.status === 'failed' || msg.status === 'error') msgStatus = 'failed';
      else if (msg.status === 'pending') msgStatus = 'pending';

      const msgCreatedAt = new Date(msg.ts || Date.now()).toISOString();

      insertMsgStmt.run(
        msg.id,
        convId,
        direction,
        type,
        kind,
        msg.body ?? null,
        mediaUrl,
        mediaType,
        msg.wa_message_id ?? null,
        msgStatus,
        msgCreatedAt,
        msgCreatedAt
      );
    }

    // 10. Migrate CRM Stages and Leads (ADR 0037, 0038)
    let legacyStages: Array<{ id: string; name: string; position: number; role?: string; created_at: number }> = [];
    try {
      legacyStages = legacyDb.prepare('SELECT * FROM crm_stages ORDER BY position ASC').all() as any;
    } catch {
      legacyStages = [];
    }

    let defaultFunnelId: string = crypto.randomUUID();
    const insertFunnelStmt = targetDb.prepare(`
      INSERT INTO funnels (id, organization_id, name, stages, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const funnelStages = legacyStages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      role: s.role || null,
    }));

    insertFunnelStmt.run(
      defaultFunnelId,
      organizationId,
      'Funil Principal de Vendas',
      JSON.stringify(funnelStages),
      now,
      now
    );

    let legacyLeads: Array<{
      id: string;
      phone_e164: string;
      stage_id: string;
      notes?: string;
      created_at: number;
      updated_at: number;
    }> = [];
    try {
      legacyLeads = legacyDb.prepare('SELECT * FROM crm_leads').all() as any;
    } catch {
      legacyLeads = [];
    }

    const insertLeadStmt = targetDb.prepare(`
      INSERT INTO leads (id, organization_id, funnel_id, contact_id, stage_id, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let targetLeadsCount = 0;
    const seenLeads = new Set<string>();

    for (const lead of legacyLeads) {
      const norm = normalizePhoneNumber(lead.phone_e164, '55');
      const phone = norm.isValid ? norm.e164 : lead.phone_e164.trim();
      let contactId = phoneToCanonicalContactId.get(phone);
      if (!contactId) {
        contactId = crypto.randomUUID();
        insertContactStmt.run(contactId, organizationId, phone, null, '{}', 0, now, now);
        phoneToCanonicalContactId.set(phone, contactId);
        targetCanonicalContactsCount++;
      }

      const leadKey = `${defaultFunnelId}:${contactId}`;
      if (seenLeads.has(leadKey)) continue;
      seenLeads.add(leadKey);

      insertLeadStmt.run(
        lead.id,
        organizationId,
        defaultFunnelId,
        contactId,
        lead.stage_id,
        lead.notes ?? null,
        new Date(lead.created_at || Date.now()).toISOString(),
        new Date(lead.updated_at || Date.now()).toISOString()
      );
      targetLeadsCount++;
    }

    targetDb.exec('COMMIT;');

    // 11. Generate Reconciliation Report
    const sourceCounts: SourceCounts = {
      lists: legacyLists.length,
      contacts: legacyContacts.length,
      uniquePhones: phoneGroups.size,
      campaigns: legacyCampaigns.length,
      campaignJobs: legacyJobs.length,
      inFlightJobs: inFlightJobsCount,
      optOuts: legacyOptOutPhones.size,
      chats: legacyChats.length,
      messages: legacyMessages.length,
      stages: legacyStages.length,
      leads: legacyLeads.length,
      mediaFiles: manifest.files?.filter((f) => f.path.startsWith('media/') || f.path.endsWith('.jpg') || f.path.endsWith('.png') || f.path.endsWith('.ogg')).length ?? 0,
    };

    const targetCounts: TargetCounts = {
      bases: legacyLists.length,
      canonicalContacts: targetCanonicalContactsCount,
      baseMemberships: targetBaseMembershipsCount,
      campaigns: legacyCampaigns.length,
      campaignJobs: legacyJobs.length,
      unknownJobs: targetUnknownJobsCount,
      optOuts: targetOptOutsCount,
      conversations: jidToConversationId.size,
      messages: legacyMessages.length,
      funnels: 1,
      leads: targetLeadsCount,
      mediaFiles: mediaFilesImportedCount,
    };

    const report: ReconciliationReport = {
      source: sourceCounts,
      target: targetCounts,
      discrepancies,
      importedAt: now,
    };

    return {
      organizationId,
      report,
      mediaIdMapping,
    };
  } catch (err) {
    try {
      targetDb.exec('ROLLBACK;');
    } catch {
      // ignore
    }
    throw err;
  }
}
