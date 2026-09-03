import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
export { DatabaseSync, StatementSync } from 'node:sqlite';
import { DatabaseError } from './errors.js';

export interface DatabaseConnectionOptions {
  /**
   * Directory where the database file resides. If provided, the database
   * file will be `${dataDir}/dispar-flux.sqlite`.
   */
  dataDir?: string;

  /**
   * Direct path to the SQLite database file, or ':memory:' for in-memory database.
   * If specified, takes precedence over dataDir.
   */
  filePath?: string;

  /**
   * Whether to open the database in read-only mode. Default is false.
   */
  readOnly?: boolean;
}

export class DatabaseConnection {
  private _db: DatabaseSync | null = null;
  public readonly filePath: string;

  constructor(options: DatabaseConnectionOptions = {}) {
    this.filePath = DatabaseConnection.resolveFilePath(options);
    this.open(options.readOnly);
  }

  /**
   * Resolves the SQLite database file path based on provided options or environment.
   */
  static resolveFilePath(options: DatabaseConnectionOptions = {}): string {
    if (options.filePath) {
      return options.filePath;
    }

    const dataDir = options.dataDir || process.env.DATA_DIR || './data';
    return path.join(dataDir, 'dispar-flux.sqlite');
  }

  private open(readOnly = false): void {
    try {
      if (this.filePath !== ':memory:') {
        const dir = path.dirname(path.resolve(this.filePath));
        fs.mkdirSync(dir, { recursive: true });
      }

      this._db = new DatabaseSync(this.filePath, { readOnly });

      // Execute required PRAGMAs per specification
      this._db.exec('PRAGMA journal_mode = WAL;');
      this._db.exec('PRAGMA foreign_keys = ON;');
      this._db.exec('PRAGMA busy_timeout = 5000;');
      this._db.exec('PRAGMA synchronous = NORMAL;');
    } catch (err) {
      this._db = null;
      throw new DatabaseError(
        `Failed to open SQLite database at "${this.filePath}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  /**
   * Underlying native SQLite DatabaseSync instance.
   */
  get db(): DatabaseSync {
    if (!this._db) {
      throw new DatabaseError('Database connection is closed');
    }
    return this._db;
  }

  get isOpen(): boolean {
    return this._db !== null;
  }

  /**
   * Executes one or more SQL statements directly.
   */
  exec(sql: string): void {
    try {
      this.db.exec(sql);
    } catch (err) {
      throw new DatabaseError(
        `Database execution error: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  /**
   * Prepares a SQL statement for execution.
   */
  prepare(sql: string): StatementSync {
    try {
      return this.db.prepare(sql);
    } catch (err) {
      throw new DatabaseError(
        `Failed to prepare SQL statement: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  /**
   * Queries a PRAGMA value.
   */
  getPragma(pragmaName: string): unknown {
    try {
      const stmt = this.prepare(`PRAGMA ${pragmaName};`);
      const row = stmt.get() as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return row[pragmaName] ?? Object.values(row)[0];
    } catch (err) {
      throw new DatabaseError(`Failed to read PRAGMA ${pragmaName}: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
  }

  /**
   * Executes a synchronous callback inside an exclusive transaction.
   * Commits if successful, rolls back on error.
   */
  transaction<T>(action: () => T): T {
    this.exec('BEGIN IMMEDIATE;');
    try {
      const result = action();
      this.exec('COMMIT;');
      return result;
    } catch (err) {
      try {
        this.exec('ROLLBACK;');
      } catch {
        // Suppress rollback errors if connection failed
      }
      throw err;
    }
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    if (this._db) {
      try {
        this._db.close();
      } finally {
        this._db = null;
      }
    }
  }
}

/**
 * Creates and opens a new DatabaseConnection.
 */
export function openDatabase(options: DatabaseConnectionOptions = {}): DatabaseConnection {
  return new DatabaseConnection(options);
}
