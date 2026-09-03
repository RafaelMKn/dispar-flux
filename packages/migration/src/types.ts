import type { DatabaseConnection } from '@dispar-flux/database';
import type { DatabaseSync } from 'node:sqlite';

export interface MigrationManifestFile {
  path: string;
  sha256: string;
  size: number;
}

export interface MigrationManifestEntityCounts {
  lists?: number;
  contacts?: number;
  campaigns?: number;
  campaignJobs?: number;
  optOuts?: number;
  chats?: number;
  messages?: number;
  stages?: number;
  leads?: number;
  mediaFiles?: number;
}

export interface MigrationManifest {
  version: string;
  schemaVersion: number;
  createdAt: string;
  sourceApp: 'dispar-flux-desktop';
  suggestedOperationalTimezone?: string;
  entityCounts: MigrationManifestEntityCounts;
  files: MigrationManifestFile[];
}

export interface SourceCounts {
  lists: number;
  contacts: number;
  uniquePhones: number;
  campaigns: number;
  campaignJobs: number;
  inFlightJobs: number;
  optOuts: number;
  chats: number;
  messages: number;
  stages: number;
  leads: number;
  mediaFiles: number;
}

export interface TargetCounts {
  bases: number;
  canonicalContacts: number;
  baseMemberships: number;
  campaigns: number;
  campaignJobs: number;
  unknownJobs: number;
  optOuts: number;
  conversations: number;
  messages: number;
  funnels: number;
  leads: number;
  mediaFiles: number;
}

export interface ReconciliationReport {
  source: SourceCounts;
  target: TargetCounts;
  discrepancies: string[];
  importedAt: string;
}

export interface ImportMigrationOptions {
  packagePath: string;
  targetDb: DatabaseConnection | DatabaseSync;
  organizationId?: string;
  organizationName?: string;
  storageDir?: string;
  skipChecksumValidation?: boolean;
}

export interface ImportResult {
  organizationId: string;
  report: ReconciliationReport;
  mediaIdMapping: Record<string, string>;
}

export type DeletionType = 'contact_deletion' | 'opt_out';

export interface DeletionLedgerRecord {
  id: string;
  type: DeletionType;
  normalizedPhone: string;
  timestamp: string;
  reason?: string;
  actorId?: string;
}

export interface BackupManifest {
  version: string;
  schemaVersion: number;
  createdAt: string;
  backupType: 'disaster_recovery';
  installationId?: string;
  database: {
    fileName: string;
    sha256: string;
    size: number;
  };
  files: Array<{
    path: string;
    sha256: string;
    size: number;
  }>;
  entityCounts: Record<string, number>;
  deletionLedgerCount: number;
}

export interface CreateBackupOptions {
  dataDir?: string;
  recoveryKey: string;
  outputPath?: string;
  db?: DatabaseConnection | DatabaseSync;
  dbPath?: string;
  organizationId?: string;
  deletionLedger?: DeletionLedgerRecord[];
  deletionLedgerPath?: string;
  includeMedia?: boolean;
  includeWaAuth?: boolean;
  metadata?: Record<string, unknown>;
}

export interface BackupResult {
  backupPath?: string;
  backupBuffer?: Buffer;
  checksum: string;
  manifest: BackupManifest;
  sizeBytes: number;
  encryptedSizeBytes?: number;
}

export type CreateBackupResult = BackupResult;

export interface RestoreBackupOptions {
  backupPath?: string;
  backupBuffer?: Buffer;
  recoveryKey: string;
  targetDataDir?: string;
  targetDbPath?: string;
  deletionLedger?: DeletionLedgerRecord[];
  deletionLedgerRecords?: DeletionLedgerRecord[];
  deletionLedgerPath?: string;
  organizationId?: string;
  validateIntegrity?: boolean;
}

export interface RestoreResult {
  restoredAt: string;
  manifest: BackupManifest;
  integrityValid: boolean;
  reappliedDeletionsCount: number;
  reappliedOptOutsCount: number;
  targetDbPath?: string;
  reappliedDeletions?: {
    reappliedDeletionsCount: number;
    reappliedOptOutsCount: number;
  };
}

export type RestoreBackupResult = RestoreResult;
