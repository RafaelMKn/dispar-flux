import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseConnection } from '@dispar-flux/database';
import {
  InvalidRecoveryKeyError,
  CorruptedBackupError,
} from './errors.js';
import {
  sha256,
  sha256File,
  encryptBackupPayload,
  decryptBackupPayload,
} from './crypto.js';
import {
  packTar,
  unpackTar,
  unpackToDirectory,
  type TarEntry,
} from './tar.js';
import {
  reapplyDeletionLedger,
  loadDeletionLedger,
} from './deletion-ledger.js';
import type {
  BackupManifest,
  CreateBackupOptions,
  BackupResult,
  RestoreBackupOptions,
  RestoreResult,
  DeletionLedgerRecord,
} from './types.js';

/**
 * Creates an encrypted disaster recovery backup of the installation.
 * (ADR 0017, 0020, 0031, 0046, 0053).
 *
 * Contains:
 * - Consistent SQLite snapshot (flushed via WAL checkpoint)
 * - Media files (excluding regenerable avatars and logs per ADR 0017)
 * - WhatsApp credentials and session state (`wa-auth`) (ADR 0046)
 * - Current Deletion Ledger
 * - Backup manifest with SHA-256 checksums and entity counts
 *
 * Encrypted with AES-256-GCM derived from the Recovery Key via PBKDF2 (100,000 iterations).
 */
export function createRecoveryBackup(options: CreateBackupOptions): BackupResult {
  const dataDir =
    options.dataDir ||
    (options.dbPath ? path.dirname(options.dbPath) : undefined) ||
    (options.db && 'filePath' in options.db ? path.dirname((options.db as any).filePath) : undefined) ||
    './data';
  const { recoveryKey } = options;

  if (!recoveryKey || !recoveryKey.trim()) {
    throw new InvalidRecoveryKeyError('Recovery key cannot be empty');
  }

  if (!fs.existsSync(dataDir)) {
    throw new CorruptedBackupError(`Data directory not found: ${dataDir}`);
  }

  const dbPath = options.dbPath || path.join(dataDir, 'dispar-flux.sqlite');
  if (!fs.existsSync(dbPath)) {
    throw new CorruptedBackupError(`SQLite database not found at "${dbPath}"`);
  }

  // 1. Ensure WAL checkpoint so database file is self-contained and consistent
  try {
    const tempDb = new DatabaseSync(dbPath);
    try {
      tempDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } finally {
      tempDb.close();
    }
  } catch {
    // If checkpoint fails (e.g. read-only or locked), proceed with existing bytes
  }

  const entries: TarEntry[] = [];
  const manifestFiles: Array<{ path: string; sha256: string; size: number }> = [];

  // 2. Add SQLite database
  const dbBuffer = fs.readFileSync(dbPath);
  const dbHash = sha256(dbBuffer);
  entries.push({
    name: 'dispar-flux.sqlite',
    data: dbBuffer,
  });

  // Query entity counts from the consistent database
  const entityCounts: Record<string, number> = {};
  try {
    const tempDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tables = ['organizations', 'contacts', 'campaigns', 'messages', 'opt_outs'];
      for (const t of tables) {
        try {
          const res = tempDb.prepare(`SELECT count(*) as cnt FROM ${t}`).get() as { cnt: number };
          entityCounts[t] = Number(res?.cnt || 0);
        } catch {
          entityCounts[t] = 0;
        }
      }
    } finally {
      tempDb.close();
    }
  } catch {
    // ignore
  }

  // 3. Add media files (ADR 0017, ADR 0046) - exclude logs and avatars
  let mediaCount = 0;
  if (options.includeMedia !== false) {
    const mediaDir = path.join(dataDir, 'media');
    if (fs.existsSync(mediaDir)) {
      const mediaItems = fs.readdirSync(mediaDir, { recursive: true, withFileTypes: true });
      for (const item of mediaItems) {
        if (item.isFile()) {
          const relPath = path.relative(dataDir, path.join(item.parentPath || mediaDir, item.name)).replace(/\\/g, '/');
          const fullPath = path.join(dataDir, relPath);
          const buf = fs.readFileSync(fullPath);
          entries.push({
            name: relPath,
            data: buf,
          });
          manifestFiles.push({
            path: relPath,
            sha256: sha256(buf),
            size: buf.length,
          });
          mediaCount++;
        }
      }
    }
  }
  entityCounts['mediaFiles'] = mediaCount;

  // 4. Add live wa-auth credentials (ADR 0046)
  if (options.includeWaAuth !== false) {
    const waAuthDir = path.join(dataDir, 'wa-auth');
    if (fs.existsSync(waAuthDir)) {
      const authItems = fs.readdirSync(waAuthDir, { recursive: true, withFileTypes: true });
      for (const item of authItems) {
        if (item.isFile()) {
          const relPath = path.relative(dataDir, path.join(item.parentPath || waAuthDir, item.name)).replace(/\\/g, '/');
          const fullPath = path.join(dataDir, relPath);
          const buf = fs.readFileSync(fullPath);
          entries.push({
            name: relPath,
            data: buf,
          });
          manifestFiles.push({
            path: relPath,
            sha256: sha256(buf),
            size: buf.length,
          });
        }
      }
    }
  }

  // 5. Add Deletion Ledger (ADR 0031)
  let deletionLedgerRecords: DeletionLedgerRecord[] = [];
  if (options.deletionLedger && options.deletionLedger.length > 0) {
    deletionLedgerRecords = [...options.deletionLedger];
  } else if (options.deletionLedgerPath && fs.existsSync(options.deletionLedgerPath)) {
    deletionLedgerRecords = loadDeletionLedger(options.deletionLedgerPath);
  } else {
    const defaultLedgerPath = path.join(dataDir, 'deletion-ledger.json');
    if (fs.existsSync(defaultLedgerPath)) {
      deletionLedgerRecords = loadDeletionLedger(defaultLedgerPath);
    }
  }

  const ledgerBuffer = Buffer.from(JSON.stringify(deletionLedgerRecords, null, 2), 'utf8');
  entries.push({
    name: 'deletion-ledger.json',
    data: ledgerBuffer,
  });

  // 6. Build Manifest
  const manifest: BackupManifest = {
    version: '1.0.0',
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    backupType: 'disaster_recovery',
    database: {
      fileName: 'dispar-flux.sqlite',
      sha256: dbHash,
      size: dbBuffer.length,
    },
    files: manifestFiles,
    entityCounts,
    deletionLedgerCount: deletionLedgerRecords.length,
  };

  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  entries.unshift({
    name: 'backup-manifest.json',
    data: manifestBuffer,
  });

  // 7. Pack into tar
  const tarBuffer = packTar(entries);

  // 8. Encrypt using AES-256-GCM + PBKDF2
  const encryptedBuffer = encryptBackupPayload(tarBuffer, recoveryKey);
  const checksum = sha256(encryptedBuffer);

  // 9. Write to file if outputPath is specified
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, encryptedBuffer);
  }

  return {
    backupPath: options.outputPath,
    backupBuffer: encryptedBuffer,
    checksum,
    manifest,
    sizeBytes: encryptedBuffer.length,
  };
}

/**
 * Decrypts and restores the installation from a Disaster Recovery Backup.
 * (ADR 0017, 0020, 0031, 0046, 0053).
 *
 * - Decrypts with AES-256-GCM using the Recovery Key.
 * - Restores SQLite snapshot, media, and wa-auth credentials.
 * - Re-applies external/provided Deletion Ledger (ADR 0031) to prevent resurrecting deleted contacts.
 * - Validates restored database integrity via `PRAGMA integrity_check`.
 */
export function restoreRecoveryBackup(options: RestoreBackupOptions): RestoreResult {
  const targetDataDir = options.targetDataDir || (options.targetDbPath ? path.dirname(options.targetDbPath) : './data');
  const { recoveryKey } = options;

  if (!recoveryKey || !recoveryKey.trim()) {
    throw new InvalidRecoveryKeyError('Recovery key cannot be empty');
  }

  let encryptedBuffer: Buffer;
  if (options.backupBuffer) {
    encryptedBuffer = options.backupBuffer;
  } else if (options.backupPath) {
    if (!fs.existsSync(options.backupPath)) {
      throw new CorruptedBackupError(`Backup file not found: ${options.backupPath}`);
    }
    encryptedBuffer = fs.readFileSync(options.backupPath);
  } else {
    throw new CorruptedBackupError('Either backupBuffer or backupPath must be provided');
  }

  // 1. Decrypt backup payload
  const decryptedTar = decryptBackupPayload(encryptedBuffer, recoveryKey);

  // 2. Unpack into target data directory
  fs.mkdirSync(targetDataDir, { recursive: true });
  unpackToDirectory(decryptedTar, targetDataDir);

  // 3. Verify manifest
  const manifestPath = path.join(targetDataDir, 'backup-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new CorruptedBackupError('Restored backup is missing backup-manifest.json');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;

  // Verify database file checksum
  const dbPath = path.join(targetDataDir, manifest.database.fileName);
  if (!fs.existsSync(dbPath)) {
    throw new CorruptedBackupError(`Restored database file not found at "${dbPath}"`);
  }

  const actualDbHash = sha256File(dbPath);
  if (actualDbHash.toLowerCase() !== manifest.database.sha256.toLowerCase()) {
    throw new CorruptedBackupError(
      `Restored database checksum mismatch: expected ${manifest.database.sha256}, got ${actualDbHash}`
    );
  }

  let finalDbPath = dbPath;
  if (options.targetDbPath && path.resolve(options.targetDbPath) !== path.resolve(dbPath)) {
    fs.mkdirSync(path.dirname(options.targetDbPath), { recursive: true });
    fs.copyFileSync(dbPath, options.targetDbPath);
    finalDbPath = options.targetDbPath;
  }

  // 4. Validate database integrity (ADR 0046, 0053)
  let integrityValid = false;
  if (options.validateIntegrity !== false) {
    const db = new DatabaseSync(finalDbPath);
    try {
      const integrityRow = db.prepare('PRAGMA integrity_check;').get() as Record<string, unknown> | undefined;
      const integrityVal = integrityRow ? Object.values(integrityRow)[0] : undefined;
      if (integrityVal !== 'ok') {
        throw new CorruptedBackupError(`Restored database failed integrity check: ${integrityVal}`);
      }

      const fkRows = db.prepare('PRAGMA foreign_key_check;').all();
      if (fkRows.length > 0) {
        throw new CorruptedBackupError(`Restored database failed foreign key check (${fkRows.length} violations)`);
      }

      integrityValid = true;
    } finally {
      db.close();
    }
  }

  // 5. Re-apply Deletion Ledger (ADR 0031)
  let reappliedDeletionsCount = 0;
  let reappliedOptOutsCount = 0;

  // Prioritize externally provided deletion ledger (e.g. from post-backup operations)
  let ledgerToApply: DeletionLedgerRecord[] = [];
  if (options.deletionLedger && options.deletionLedger.length > 0) {
    ledgerToApply = options.deletionLedger;
  } else if (options.deletionLedgerRecords && options.deletionLedgerRecords.length > 0) {
    ledgerToApply = options.deletionLedgerRecords;
  } else if (options.deletionLedgerPath && fs.existsSync(options.deletionLedgerPath)) {
    ledgerToApply = loadDeletionLedger(options.deletionLedgerPath);
  }

  if (ledgerToApply.length > 0) {
    const db = new DatabaseSync(finalDbPath);
    try {
      const result = reapplyDeletionLedger(db, ledgerToApply);
      reappliedDeletionsCount = result.reappliedDeletionsCount;
      reappliedOptOutsCount = result.reappliedOptOutsCount;
    } finally {
      db.close();
    }
  }

  return {
    restoredAt: new Date().toISOString(),
    manifest,
    integrityValid,
    reappliedDeletionsCount,
    reappliedOptOutsCount,
    targetDbPath: finalDbPath,
    reappliedDeletions: {
      reappliedDeletionsCount,
      reappliedOptOutsCount,
    },
  };
}

export class BackupService {
  static createBackup(options: CreateBackupOptions): BackupResult {
    return createRecoveryBackup(options);
  }
  static restoreBackup(options: RestoreBackupOptions): RestoreResult {
    return restoreRecoveryBackup(options);
  }
}
