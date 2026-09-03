import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseConnection, runMigrations } from '@dispar-flux/database';

export interface TestContext {
  db: DatabaseConnection;
  dataDir: string;
  cleanup: () => void;
}

export function createTestContext(): TestContext {
  const dataDir = path.join(os.tmpdir(), `dispar-auth-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'dispar-flux.sqlite');
  const db = new DatabaseConnection({ filePath: dbPath });

  // Run initial schema migrations
  runMigrations(db);

  const cleanup = () => {
    db.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup on windows
    }
  };

  return { db, dataDir, cleanup };
}
