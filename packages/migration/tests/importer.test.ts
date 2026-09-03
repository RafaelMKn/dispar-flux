import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { openDatabase, runMigrations } from '@dispar-flux/database';
import {
  createMigrationPackage,
  validateMigrationPackage,
  importMigrationPackage,
  ManifestValidationError,
  TargetNotCleanError,
} from '../src/index.js';

describe('Migration Package: Importer & Validation (ADR 0008, 0014, 0017, 0028, 0034)', () => {
  function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `df-mig-test-${prefix}-`));
  }

  it('validates a well-formed migration package successfully', () => {
    const tempDir = makeTempDir('valid-pkg');
    try {
      const { packageDir, manifest } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
        seedData: {
          lists: [{ id: 'list-1', name: 'Lista Clientes 2026', created_at: Date.now() }],
          contacts: [
            {
              id: 'c1',
              list_id: 'list-1',
              name: 'Rafael Teste',
              phone_e164: '+5511987654321',
              created_at: Date.now(),
            },
          ],
        },
      });

      const val = validateMigrationPackage(packageDir);
      assert.equal(val.valid, true);
      assert.equal(val.manifest.schemaVersion, 1);
      assert.equal(val.manifest.sourceApp, 'dispar-flux-desktop');
      assert.equal(val.manifest.entityCounts.lists, 1);
      assert.equal(val.manifest.entityCounts.contacts, 1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects migration package with unsupported schema version', () => {
    const tempDir = makeTempDir('invalid-ver');
    try {
      const { packageDir } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
      });

      const manifestPath = path.join(packageDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.schemaVersion = 99;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      assert.throws(
        () => validateMigrationPackage(packageDir),
        (err: unknown) => {
          return err instanceof ManifestValidationError && err.message.includes('schema version');
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects migration package containing WhatsApp credentials (wa-auth) or secret keys (ADR 0008)', () => {
    const tempDir = makeTempDir('creds-violation');
    try {
      const { packageDir } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
      });

      // Inject prohibited credentials file
      const manifestPath = path.join(packageDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.files.push({
        path: 'wa-auth/creds.json',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        size: 0,
      });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      assert.throws(
        () => validateMigrationPackage(packageDir),
        (err: unknown) => {
          return err instanceof ManifestValidationError && err.message.includes('ADR 0008');
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects and rejects tampered files with SHA-256 checksum mismatches', () => {
    const tempDir = makeTempDir('checksum-mismatch');
    try {
      const { packageDir } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
        mediaFiles: [
          { relativePath: 'media/promo.jpg', content: Buffer.from('original photo bytes') },
        ],
      });

      // Tamper with file on disk keeping exact same length (20 bytes) to test checksum failure
      fs.writeFileSync(path.join(packageDir, 'media', 'promo.jpg'), Buffer.from('corrupted photo byte'));

      assert.throws(
        () => validateMigrationPackage(packageDir),
        (err: unknown) => {
          return err instanceof ManifestValidationError && err.message.includes('SHA-256 checksum verification failed');
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects and rejects packages with mismatched entity counts', () => {
    const tempDir = makeTempDir('counts-mismatch');
    try {
      const { packageDir } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
        seedData: {
          lists: [{ id: 'l1', name: 'Lista 1', created_at: Date.now() }],
        },
      });

      // Tamper manifest entity count
      const manifestPath = path.join(packageDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.entityCounts.lists = 5; // Actual is 1
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));

      assert.throws(
        () => validateMigrationPackage(packageDir),
        (err: unknown) => {
          return err instanceof ManifestValidationError && err.message.includes('Entity count mismatch');
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('only allows import into a clean/uninitialized installation (ADR 0014)', () => {
    const tempDir = makeTempDir('clean-check');
    const targetConn = openDatabase({ filePath: ':memory:' });
    try {
      runMigrations(targetConn);

      const { packageDir } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
        seedData: {
          lists: [{ id: 'l1', name: 'Lista Vendas', created_at: Date.now() }],
          contacts: [{ id: 'c1', list_id: 'l1', phone_e164: '+5511987654321', created_at: Date.now() }],
        },
      });

      // 1. First import into clean DB succeeds
      const result = importMigrationPackage({
        packagePath: packageDir,
        targetDb: targetConn,
      });
      assert.ok(result.organizationId);
      assert.equal(result.report.target.canonicalContacts, 1);

      // 2. Second import attempt into the now populated DB MUST FAIL per ADR 0014
      assert.throws(
        () => {
          importMigrationPackage({
            packagePath: packageDir,
            targetDb: targetConn,
          });
        },
        (err: unknown) => {
          return err instanceof TargetNotCleanError && err.message.includes('ADR 0014');
        }
      );
    } finally {
      targetConn.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  it('consolidates duplicate legacy rows by normalized phone number into single canonical Contacts with BaseMemberships (ADR 0034)', () => {
    const tempDir = makeTempDir('consolidation');
    const targetConn = openDatabase({ filePath: ':memory:' });
    try {
      runMigrations(targetConn);

      const { packageDir } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
        seedData: {
          lists: [
            { id: 'list-sp', name: 'Leads SP', created_at: Date.now() - 10000 },
            { id: 'list-vip', name: 'Leads VIP', created_at: Date.now() - 5000 },
          ],
          // Three legacy rows representing the SAME person in different formats and lists:
          // 1) E.164: +5511987654321 in list-sp
          // 2) Local 11 digits: 11987654321 in list-vip
          // 3) Old 8-digit format missing the 9: 1187654321 in list-sp
          contacts: [
            {
              id: 'c-sp',
              list_id: 'list-sp',
              name: 'Maria Silva',
              phone_e164: '+5511987654321',
              extra_json: JSON.stringify({ cargo: 'Gerente', cidade: 'São Paulo' }),
              opt_out: 0,
              created_at: 1000,
            },
            {
              id: 'c-vip',
              list_id: 'list-vip',
              name: 'Maria S. VIP',
              phone_e164: '11987654321',
              extra_json: JSON.stringify({ nivel: 'Platina' }),
              opt_out: 1, // Opt-out in VIP list!
              created_at: 2000,
            },
            {
              id: 'c-old',
              list_id: 'list-sp',
              name: 'Maria',
              phone_e164: '1187654321', // missing 9th digit, should normalize to +5511987654321
              extra_json: JSON.stringify({ observacao: 'Contato antigo' }),
              opt_out: 0,
              created_at: 3000,
            },
            // Another completely different contact:
            {
              id: 'c-joao',
              list_id: 'list-sp',
              name: 'João Souza',
              phone_e164: '+5521998877665',
              opt_out: 0,
              created_at: 4000,
            },
          ],
        },
      });

      const result = importMigrationPackage({
        packagePath: packageDir,
        targetDb: targetConn,
      });

      // Verification:
      // 4 legacy contact rows should result in exactly 2 canonical contacts!
      const contacts = targetConn.prepare('SELECT * FROM contacts ORDER BY normalized_phone ASC').all() as any[];
      assert.equal(contacts.length, 2, 'Expected exactly 2 canonical contacts');

      const maria = contacts.find((c) => c.normalized_phone === '+5511987654321');
      assert.ok(maria, 'Canonical contact for Maria with normalized phone +5511987654321 must exist');
      assert.equal(maria.name, 'Maria Silva');
      // Opt-out from any duplicate list must propagate to canonical contact (ADR 0040)
      assert.equal(maria.is_opted_out, 1, 'Canonical contact must have is_opted_out = 1');

      // Verify opt_outs table entry
      const optOutRow = targetConn.prepare('SELECT * FROM opt_outs WHERE normalized_phone = ?').get('+5511987654321') as any;
      assert.ok(optOutRow, 'Opt-out record must exist in opt_outs table');

      // Verify BaseMemberships: Maria belonged to list-sp and list-vip
      const memberships = targetConn
        .prepare('SELECT * FROM base_memberships WHERE contact_id = ? ORDER BY base_id ASC')
        .all(maria.id) as any[];
      assert.equal(memberships.length, 2, 'Maria should have memberships in both bases');

      const spMembership = memberships.find((m) => m.base_id === 'list-sp');
      assert.ok(spMembership);
      const spFields = JSON.parse(spMembership.imported_fields);
      assert.equal(spFields.cargo, 'Gerente');
      assert.equal(spFields.cidade, 'São Paulo');

      const vipMembership = memberships.find((m) => m.base_id === 'list-vip');
      assert.ok(vipMembership);
      const vipFields = JSON.parse(vipMembership.imported_fields);
      assert.equal(vipFields.nivel, 'Platina');

      // Reconciliation report reflects consolidation
      assert.equal(result.report.source.contacts, 4);
      assert.equal(result.report.target.canonicalContacts, 2);
      assert.equal(result.report.discrepancies.length > 0, true);
    } finally {
      targetConn.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves interrupted/in-flight jobs as "unknown" (Envio Incerto, ADR 0028)', () => {
    const tempDir = makeTempDir('inflight-unknown');
    const targetConn = openDatabase({ filePath: ':memory:' });
    try {
      runMigrations(targetConn);

      const { packageDir } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
        seedData: {
          lists: [{ id: 'list-1', name: 'Lista 1', created_at: Date.now() }],
          contacts: [
            { id: 'c1', list_id: 'list-1', phone_e164: '+5511987654321', created_at: 100 },
            { id: 'c2', list_id: 'list-1', phone_e164: '+5511987654322', created_at: 200 },
            { id: 'c3', list_id: 'list-1', phone_e164: '+5511987654323', created_at: 300 },
          ],
          campaigns: [
            {
              id: 'camp-1',
              name: 'Campanha Teste',
              list_id: 'list-1',
              mode: 'fixed',
              config_json: JSON.stringify({ message: 'Olá {{nome}}' }),
              delay_min_ms: 30000,
              delay_max_ms: 45000,
              rest_every_n: 20,
              rest_duration_ms: 60000,
              daily_cap: 200,
              status: 'running', // Campaign was interrupted while running!
              created_at: 50,
            },
          ],
          campaign_jobs: [
            {
              id: 'job-1',
              campaign_id: 'camp-1',
              contact_id: 'c1',
              rendered_text: 'Olá c1',
              status: 'sent',
              sent_at: 1000,
            },
            {
              id: 'job-2',
              campaign_id: 'camp-1',
              contact_id: 'c2',
              rendered_text: 'Olá c2',
              status: 'sending', // In-flight job during crash/interruption!
            },
            {
              id: 'job-3',
              campaign_id: 'camp-1',
              contact_id: 'c3',
              rendered_text: 'Olá c3',
              status: 'pending',
            },
          ],
        },
      });

      const result = importMigrationPackage({
        packagePath: packageDir,
        targetDb: targetConn,
      });

      // Verify campaign status: was running, MUST be preserved as 'paused' (ADR 0014)
      const campaign = targetConn.prepare('SELECT * FROM campaigns WHERE id = ?').get('camp-1') as any;
      assert.equal(campaign.status, 'paused', 'Running campaign must be imported as paused without auto-resuming');
      assert.equal(campaign.unknown_count, 1, 'Campaign unknown_count must be 1');
      assert.equal(campaign.sent_count, 1, 'Campaign sent_count must be 1');

      // Verify jobs: in-flight job 'sending' MUST become 'unknown' (ADR 0028)
      const jobs = targetConn.prepare('SELECT id, status FROM campaign_jobs ORDER BY id ASC').all() as any[];
      assert.equal(jobs.length, 3);

      const jobSent = jobs.find((j) => j.id === 'job-1');
      assert.equal(jobSent.status, 'sent');

      const jobInFlight = jobs.find((j) => j.id === 'job-2');
      assert.equal(jobInFlight.status, 'unknown', 'Interrupted job must be preserved as unknown (Envio Incerto)');

      const jobPending = jobs.find((j) => j.id === 'job-3');
      assert.equal(jobPending.status, 'pending');

      // Reconciliation report notes
      assert.equal(result.report.source.inFlightJobs, 1);
      assert.equal(result.report.target.unknownJobs, 1);
    } finally {
      targetConn.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rewrites media references to opaque storage IDs and copies files (ADR 0012, 0017)', () => {
    const tempDir = makeTempDir('media-rewrite');
    const targetConn = openDatabase({ filePath: ':memory:' });
    const storageDir = path.join(tempDir, 'storage');
    try {
      runMigrations(targetConn);

      const sampleImageBuffer = Buffer.from('FAKE_JPEG_IMAGE_DATA_BYTES');

      const { packageDir } = createMigrationPackage({
        outputDir: path.join(tempDir, 'package'),
        mediaFiles: [
          { relativePath: 'media/catalog.jpg', content: sampleImageBuffer },
        ],
        seedData: {
          chats: [
            {
              jid: '5511987654321@s.whatsapp.net',
              name: 'Carlos Cliente',
              last_message: 'Veja nosso catálogo',
              unread: 0,
            },
          ],
          messages: [
            {
              id: 'msg-1',
              chat_jid: '5511987654321@s.whatsapp.net',
              direction: 'out',
              body: 'Segue o catálogo:',
              ts: Date.now(),
              media_kind: 'image',
              media_path: 'media/catalog.jpg',
              media_mime: 'image/jpeg',
            },
          ],
        },
      });

      const result = importMigrationPackage({
        packagePath: packageDir,
        targetDb: targetConn,
        storageDir,
      });

      // Verify message has media_url rewritten to opaque storage format
      const msg = targetConn.prepare('SELECT * FROM messages WHERE id = ?').get('msg-1') as any;
      assert.ok(msg);
      assert.ok(msg.media_url.startsWith('storage://storage_'), `Expected opaque storage URL, got: ${msg.media_url}`);
      assert.equal(msg.media_type, 'image/jpeg');

      // Verify opaque file actually exists in storageDir with identical content
      const opaqueId = msg.media_url.replace('storage://', '');
      const storedFilePath = path.join(storageDir, opaqueId);
      assert.ok(fs.existsSync(storedFilePath), `Media file should exist in storage at ${storedFilePath}`);

      const storedBytes = fs.readFileSync(storedFilePath);
      assert.deepEqual(storedBytes, sampleImageBuffer);
    } finally {
      targetConn.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});