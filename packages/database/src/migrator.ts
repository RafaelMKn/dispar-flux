import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseConnection } from './connection.js';
import { MigrationError } from './errors.js';

export interface MigrationRecord {
  id: number;
  name: string;
  appliedAt: string;
}

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface MigratorOptions {
  migrationsDir?: string;
  migrations?: MigrationFile[];
}

export class Migrator {
  private readonly db: DatabaseSync;
  private readonly migrationsDir: string;
  private readonly customMigrations?: MigrationFile[];

  constructor(
    dbOrConnection: DatabaseSync | DatabaseConnection,
    options: MigratorOptions = {}
  ) {
    this.db = dbOrConnection instanceof DatabaseConnection ? dbOrConnection.db : dbOrConnection;
    this.customMigrations = options.migrations;
    this.migrationsDir = options.migrationsDir || Migrator.resolveDefaultMigrationsDir();
  }

  /**
   * Resolves the default migrations directory.
   */
  static resolveDefaultMigrationsDir(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const directMigrations = path.join(currentDir, 'migrations');
    if (fs.existsSync(directMigrations)) {
      return directMigrations;
    }

    // When running under dist/ during build or tsx from source
    const srcMigrations = path.resolve(currentDir, '../src/migrations');
    if (fs.existsSync(srcMigrations)) {
      return srcMigrations;
    }

    return directMigrations;
  }

  /**
   * Ensures the _migrations tracking table exists.
   */
  ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Retrieves all migrations currently recorded as applied in the database.
   */
  getAppliedMigrations(): MigrationRecord[] {
    this.ensureMigrationsTable();
    const rows = this.db
      .prepare('SELECT id, name, applied_at AS appliedAt FROM _migrations ORDER BY id ASC')
      .all() as unknown as MigrationRecord[];
    return rows;
  }

  /**
   * Discovers all available migration files, sorted in lexical order.
   */
  getAvailableMigrations(): MigrationFile[] {
    if (this.customMigrations) {
      return [...this.customMigrations].sort((a, b) => a.name.localeCompare(b.name));
    }

    if (!fs.existsSync(this.migrationsDir)) {
      throw new MigrationError(`Migrations directory not found at: ${this.migrationsDir}`);
    }

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    return files.map((file) => {
      const fullPath = path.join(this.migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf-8');
      return {
        name: file,
        sql,
      };
    });
  }

  /**
   * Computes the list of migrations that have not yet been applied.
   */
  getPendingMigrations(): MigrationFile[] {
    const applied = new Set(this.getAppliedMigrations().map((m) => m.name));
    return this.getAvailableMigrations().filter((m) => !applied.has(m.name));
  }

  /**
   * Executes all pending migrations in strict lexical order.
   * Each migration runs in an isolated transaction.
   *
   * @returns Array of newly applied migration records.
   */
  migrate(): MigrationRecord[] {
    this.ensureMigrationsTable();

    const pending = this.getPendingMigrations();
    const appliedNow: MigrationRecord[] = [];

    const insertStmt = this.db.prepare(
      'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)'
    );

    for (const migration of pending) {
      const now = new Date().toISOString();

      try {
        this.db.exec('BEGIN IMMEDIATE;');
        this.db.exec(migration.sql);
        const result = insertStmt.run(migration.name, now);
        this.db.exec('COMMIT;');

        appliedNow.push({
          id: Number(result.lastInsertRowid),
          name: migration.name,
          appliedAt: now,
        });
      } catch (err) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // Suppress rollback failure if transaction already aborted
        }
        throw new MigrationError(
          `Failed to execute migration "${migration.name}": ${err instanceof Error ? err.message : String(err)}`,
          { migrationName: migration.name, cause: err }
        );
      }
    }

    return appliedNow;
  }
}

/**
 * Helper to run migrations on a database.
 */
export function runMigrations(
  dbOrConnection: DatabaseSync | DatabaseConnection,
  options: MigratorOptions = {}
): MigrationRecord[] {
  const migrator = new Migrator(dbOrConnection, options);
  return migrator.migrate();
}
