import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, runMigrations } from '@dispar-flux/database';
import {
  createRecoveryBackup,
  restoreRecoveryBackup,
  InvalidRecoveryKeyError,
  CorruptedBackupError,
  type DeletionLedgerRecord,
} from '../src/index.js';

describe('Encrypted Disaster Recovery Backup & Restore (ADR 0017, 0020, 0031, 0046, 0053)', () => {
  function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `df-backup-test-${prefix}-`));
  }

  function setupTestInstallation(dataDir: string): {
    orgId: string;
    contactIds: string[];
  } {
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, 'dispar-flux.sqlite');
    const conn = openDatabase({ filePath: dbPath });
    runMigrations(conn);

    const now = new Date().toISOString();
    const orgId = 'org-corp-1';

    // Insert Organization
    conn.prepare(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(orgId, 'Empresa Backup Teste', 'America/Sao_Paulo', now, now);

    // Insert Messaging Connection
    conn.prepare(`
      INSERT INTO messaging_connections (id, organization_id, name, provider, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('conn-1', orgId, 'WhatsApp Backup Teste', 'baileys', 'connected', now, now);

    // Insert Contacts
    const c1Id = crypto.randomUUID();
    const c2Id = crypto.randomUUID();
    const c3Id = crypto.randomUUID();

    conn.prepare(`
      INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(c1Id, orgId, '+5511911111111', 'Contato Ativo', '{}', 0, now, now);

    conn.prepare(`
      INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(c2Id, orgId, '+5511922222222', 'Contato Para Excluir', '{}', 0, now, now);

    conn.prepare(`
      INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(c3Id, orgId, '+5511933333333', 'Contato Para OptOut', '{}', 0, now, now);

    conn.close();

    // Create media files
    const mediaDir = path.join(dataDir, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, 'documento_fiscal.pdf'), Buffer.from('PDF_DUMMY_BINARY_DATA'));

    // Create live wa-auth credentials (ADR 0046)
    const waAuthDir = path.join(dataDir, 'wa-auth');
    fs.mkdirSync(waAuthDir, { recursive: true });
    fs.writeFileSync(path.join(waAuthDir, 'creds.json'), JSON.stringify({ noiseKey: 'noise_123', me: { id: '5511911111111' } }));
    fs.writeFileSync(path.join(waAuthDir, 'app-state-sync-key.json'), JSON.stringify({ key: 'state_key_456' }));

    // Create a regenerable avatar and a log file (which MUST be excluded per ADR 0017)
    const avatarsDir = path.join(dataDir, 'userData', 'avatars');
    fs.mkdirSync(avatarsDir, { recursive: true });
    fs.writeFileSync(path.join(avatarsDir, 'avatar_c1.png'), Buffer.from('TEMP_AVATAR_BYTES'));

    return { orgId, contactIds: [c1Id, c2Id, c3Id] };
  }

  it('creates encrypted backup containing SQLite snapshot, media files, and live wa-auth session credentials (ADR 0046)', () => {
    const tempDir = makeTempDir('create-backup');
    const sourceDataDir = path.join(tempDir, 'source-data');
    const backupArtifactPath = path.join(tempDir, 'dispar-flux-backup.dfbak');
    const recoveryKey = 'RK-secure-disaster-recovery-key-2026-xyz!';

    try {
      setupTestInstallation(sourceDataDir);

      const backupResult = createRecoveryBackup({
        dataDir: sourceDataDir,
        recoveryKey,
        outputPath: backupArtifactPath,
      });

      // 1. Verify backup file exists
      assert.ok(fs.existsSync(backupArtifactPath), 'Backup file must exist');
      const backupBytes = fs.readFileSync(backupArtifactPath);
      assert.equal(backupBytes.length, backupResult.sizeBytes);

      // 2. Verify magic header 'DFBK'
      assert.equal(backupBytes.subarray(0, 4).toString('ascii'), 'DFBK');

      // 3. Verify raw bytes are encrypted and cannot be read as plaintext or plain tar
      const rawText = backupBytes.toString('utf8');
      assert.ok(!rawText.includes('Contato Ativo'), 'Encrypted backup must NOT leak plaintext database content');
      assert.ok(!rawText.includes('noise_123'), 'Encrypted backup must NOT leak plaintext wa-auth credentials');

      // 4. Verify manifest metadata
      assert.equal(backupResult.manifest.backupType, 'disaster_recovery');
      assert.equal(backupResult.manifest.database.fileName, 'dispar-flux.sqlite');
      assert.ok(backupResult.manifest.database.sha256.length === 64);
      assert.equal(backupResult.manifest.entityCounts.contacts, 3);
      assert.equal(backupResult.manifest.entityCounts.organizations, 1);

      // 5. Verify wa-auth is included per ADR 0046
      const hasWaAuth = backupResult.manifest.files.some((f) => f.path.includes('wa-auth/creds.json'));
      assert.ok(hasWaAuth, 'wa-auth credentials must be included in disaster recovery backup (ADR 0046)');

      // 6. Verify avatars and logs are excluded per ADR 0017
      const hasAvatar = backupResult.manifest.files.some((f) => f.path.includes('avatar'));
      assert.equal(hasAvatar, false, 'Avatars must be excluded from backup (ADR 0017)');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('restores installation successfully with the correct Recovery Key', () => {
    const tempDir = makeTempDir('restore-success');
    const sourceDataDir = path.join(tempDir, 'source-data');
    const targetDataDir = path.join(tempDir, 'restored-data');
    const backupArtifactPath = path.join(tempDir, 'backup.dfbak');
    const recoveryKey = 'RK-my-organization-super-secret-key-12345';

    try {
      setupTestInstallation(sourceDataDir);

      const backupResult = createRecoveryBackup({
        dataDir: sourceDataDir,
        recoveryKey,
        outputPath: backupArtifactPath,
      });

      // Restore into a completely separate directory
      const restoreResult = restoreRecoveryBackup({
        backupPath: backupArtifactPath,
        recoveryKey,
        targetDataDir,
        validateIntegrity: true,
      });

      assert.equal(restoreResult.integrityValid, true);
      assert.ok(restoreResult.restoredAt);

      // Verify restored SQLite database exists and can be opened
      const restoredDbPath = path.join(targetDataDir, 'dispar-flux.sqlite');
      assert.ok(fs.existsSync(restoredDbPath));

      const restoredDb = new DatabaseSync(restoredDbPath, { readOnly: true });
      try {
        const contacts = restoredDb.prepare('SELECT count(*) as cnt FROM contacts').get() as { cnt: number };
        assert.equal(Number(contacts.cnt), 3);

        const org = restoredDb.prepare('SELECT name FROM organizations WHERE id = ?').get('org-corp-1') as any;
        assert.equal(org.name, 'Empresa Backup Teste');
      } finally {
        restoredDb.close();
      }

      // Verify media file restored
      const restoredPdf = path.join(targetDataDir, 'media', 'documento_fiscal.pdf');
      assert.ok(fs.existsSync(restoredPdf));
      assert.equal(fs.readFileSync(restoredPdf).toString('utf8'), 'PDF_DUMMY_BINARY_DATA');

      // Verify wa-auth restored
      const restoredCreds = path.join(targetDataDir, 'wa-auth', 'creds.json');
      assert.ok(fs.existsSync(restoredCreds));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails with InvalidRecoveryKeyError when wrong Recovery Key is provided', () => {
    const tempDir = makeTempDir('wrong-key');
    const sourceDataDir = path.join(tempDir, 'source-data');
    const targetDataDir = path.join(tempDir, 'restored-data');
    const backupArtifactPath = path.join(tempDir, 'backup.dfbak');
    const validKey = 'RK-correct-key-ABC';
    const wrongKey = 'RK-WRONG-KEY-INCORRECT';

    try {
      setupTestInstallation(sourceDataDir);

      createRecoveryBackup({
        dataDir: sourceDataDir,
        recoveryKey: validKey,
        outputPath: backupArtifactPath,
      });

      assert.throws(
        () => {
          restoreRecoveryBackup({
            backupPath: backupArtifactPath,
            recoveryKey: wrongKey,
            targetDataDir,
          });
        },
        (err: unknown) => {
          return err instanceof InvalidRecoveryKeyError;
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails with InvalidRecoveryKeyError or CorruptedBackupError when backup bytes are tampered', () => {
    const tempDir = makeTempDir('tampered-backup');
    const sourceDataDir = path.join(tempDir, 'source-data');
    const targetDataDir = path.join(tempDir, 'restored-data');
    const backupArtifactPath = path.join(tempDir, 'backup.dfbak');
    const recoveryKey = 'RK-tamper-test-key';

    try {
      setupTestInstallation(sourceDataDir);

      createRecoveryBackup({
        dataDir: sourceDataDir,
        recoveryKey,
        outputPath: backupArtifactPath,
      });

      // Tamper ciphertext byte
      const bytes = fs.readFileSync(backupArtifactPath);
      bytes[bytes.length - 10] = (bytes[bytes.length - 10]! ^ 0xff);
      fs.writeFileSync(backupArtifactPath, bytes);

      assert.throws(
        () => {
          restoreRecoveryBackup({
            backupPath: backupArtifactPath,
            recoveryKey,
            targetDataDir,
          });
        },
        (err: unknown) => {
          return err instanceof InvalidRecoveryKeyError || err instanceof CorruptedBackupError;
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('re-applies Deletion Ledger after restoration to prevent resurrecting deleted contacts (ADR 0031)', () => {
    const tempDir = makeTempDir('deletion-ledger');
    const sourceDataDir = path.join(tempDir, 'source-data');
    const targetDataDir = path.join(tempDir, 'restored-data');
    const backupArtifactPath = path.join(tempDir, 'backup.dfbak');
    const recoveryKey = 'RK-privacy-deletion-ledger-key';

    try {
      // Step 1: Initial state at T1 has 3 contacts:
      // Contact 1: +5511911111111
      // Contact 2: +5511922222222 (will be deleted post-backup)
      // Contact 3: +5511933333333 (will opt-out post-backup)
      const { orgId } = setupTestInstallation(sourceDataDir);

      // Create backup at T1
      createRecoveryBackup({
        dataDir: sourceDataDir,
        recoveryKey,
        outputPath: backupArtifactPath,
      });

      // Step 2: In real life, after T1, users exercise privacy rights:
      // - Contact 2 (+5511922222222) requests deletion (LGPD/GDPR right to be forgotten)
      // - Contact 3 (+5511933333333) sends STOP and opts out
      // These actions are recorded in the Deletion Ledger:
      const postBackupDeletionLedger: DeletionLedgerRecord[] = [
        {
          id: 'del-rec-1',
          type: 'contact_deletion',
          normalizedPhone: '+5511922222222',
          timestamp: new Date(Date.now() + 1000).toISOString(),
          reason: 'Solicita??o de elimina??o de dados pessoais (ADR 0031)',
          actorId: 'operator-1',
        },
        {
          id: 'del-rec-2',
          type: 'opt_out',
          normalizedPhone: '+5511933333333',
          timestamp: new Date(Date.now() + 2000).toISOString(),
          reason: 'Contato respondeu SAIR (ADR 0040)',
        },
      ];

      // Step 3: Disaster recovery restore is performed using the T1 backup.
      // ADR 0031 requires re-applying the Deletion Ledger during restore!
      const restoreResult = restoreRecoveryBackup({
        backupPath: backupArtifactPath,
        recoveryKey,
        targetDataDir,
        deletionLedger: postBackupDeletionLedger,
        validateIntegrity: true,
      });

      assert.equal(restoreResult.reappliedDeletionsCount, 1, 'Exactly 1 contact deletion should be re-applied');
      assert.equal(restoreResult.reappliedOptOutsCount, 1, 'Exactly 1 opt-out should be re-applied');

      // Step 4: Verify the database state after restoration:
      const restoredDbPath = path.join(targetDataDir, 'dispar-flux.sqlite');
      const restoredDb = new DatabaseSync(restoredDbPath, { readOnly: true });

      try {
        // Contact 1 (+5511911111111): Still active
        const c1 = restoredDb.prepare('SELECT * FROM contacts WHERE normalized_phone = ?').get('+5511911111111') as any;
        assert.ok(c1, 'Contact 1 must still exist');
        assert.equal(c1.is_opted_out, 0);

        // Contact 2 (+5511922222222): MUST NOT BE RESURRECTED! Must be deleted!
        const c2 = restoredDb.prepare('SELECT * FROM contacts WHERE normalized_phone = ?').get('+5511922222222');
        assert.equal(c2, undefined, 'Contact 2 must NOT be resurrected after restore (ADR 0031)');

        // Contact 2 must have a pseudonymous suppression key recorded (ADR 0044)
        const suppressionKeys = restoredDb.prepare('SELECT * FROM suppression_keys WHERE organization_id = ?').all(orgId) as any[];
        assert.ok(suppressionKeys.length >= 1, 'Suppression key must exist for deleted contact');

        // Contact 3 (+5511933333333): Must have is_opted_out = 1 and exist in opt_outs
        const c3 = restoredDb.prepare('SELECT * FROM contacts WHERE normalized_phone = ?').get('+5511933333333') as any;
        assert.ok(c3, 'Contact 3 must exist');
        assert.equal(c3.is_opted_out, 1, 'Contact 3 must have is_opted_out = 1 (ADR 0031, ADR 0040)');

        const optOut = restoredDb.prepare('SELECT * FROM opt_outs WHERE normalized_phone = ?').get('+5511933333333') as any;
        assert.ok(optOut, 'Opt-out row must be re-applied in opt_outs table');
      } finally {
        restoredDb.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
