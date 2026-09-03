import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, DatabaseConnection, DatabaseError } from '../src/index.js';

describe('Database: Native SQLite Connection & Pragmas', () => {
  const tempDirs: string[] = [];

  function createTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-db-test-'));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
    tempDirs.length = 0;
  });

  it('verifies WAL mode on a disk-backed database file', () => {
    const dir = createTempDir();
    const conn = openDatabase({ dataDir: dir });
    try {
      const journalMode = conn.getPragma('journal_mode');
      assert.equal(journalMode, 'wal', `Expected journal_mode to be 'wal', got ${journalMode}`);
    } finally {
      conn.close();
    }
  });

  it('verifies required PRAGMAs: foreign_keys, busy_timeout, and synchronous', () => {
    const dir = createTempDir();
    const conn = openDatabase({ dataDir: dir });
    try {
      const foreignKeys = conn.getPragma('foreign_keys');
      assert.equal(foreignKeys, 1, 'PRAGMA foreign_keys must be ON (1)');

      const busyTimeout = conn.getPragma('busy_timeout');
      assert.equal(busyTimeout, 5000, 'PRAGMA busy_timeout must be 5000 ms');

      const synchronous = conn.getPragma('synchronous');
      // In SQLite, NORMAL corresponds to 1
      assert.equal(synchronous, 1, 'PRAGMA synchronous must be NORMAL (1)');
    } finally {
      conn.close();
    }
  });

  it('enforces foreign key constraints strictly', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      conn.exec(`
        CREATE TABLE parents (id TEXT PRIMARY KEY);
        CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id));
      `);

      // Attempting to insert child without parent should fail
      assert.throws(
        () => {
          conn.prepare('INSERT INTO children (id, parent_id) VALUES (?, ?)').run('c1', 'p-nonexistent');
        },
        (err: unknown) => {
          return err instanceof Error && /FOREIGN KEY constraint failed/i.test(err.message);
        }
      );

      // Inserting valid parent then child should succeed
      conn.prepare('INSERT INTO parents (id) VALUES (?)').run('p1');
      conn.prepare('INSERT INTO children (id, parent_id) VALUES (?, ?)').run('c1', 'p1');

      const child = conn.prepare('SELECT * FROM children WHERE id = ?').get('c1') as { id: string; parent_id: string };
      assert.equal(child.id, 'c1');
      assert.equal(child.parent_id, 'p1');
    } finally {
      conn.close();
    }
  });

  it('tests persistence across close and reopen on disk', () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'test-persist.sqlite');

    // 1. Open, create table, insert row, close
    const conn1 = openDatabase({ filePath });
    conn1.exec('CREATE TABLE test_data (id TEXT PRIMARY KEY, value TEXT NOT NULL);');
    conn1.prepare('INSERT INTO test_data (id, value) VALUES (?, ?)').run('item-1', 'dispar-flux-persistence');
    conn1.close();

    assert.equal(conn1.isOpen, false);

    // 2. Reopen same file, verify row is present
    const conn2 = openDatabase({ filePath });
    try {
      assert.equal(conn2.isOpen, true);
      const row = conn2.prepare('SELECT id, value FROM test_data WHERE id = ?').get('item-1') as { id: string; value: string };
      assert.ok(row, 'Row must exist after reopening database');
      assert.equal(row.id, 'item-1');
      assert.equal(row.value, 'dispar-flux-persistence');
    } finally {
      conn2.close();
    }
  });

  it('executes actions inside transaction: commits on success and rolls back on error', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      conn.exec('CREATE TABLE counter (id TEXT PRIMARY KEY, val INTEGER NOT NULL);');
      conn.prepare('INSERT INTO counter (id, val) VALUES (?, ?)').run('c1', 10);

      // Successful transaction
      conn.transaction(() => {
        conn.prepare('UPDATE counter SET val = val + 5 WHERE id = ?').run('c1');
      });

      const rowAfterCommit = conn.prepare('SELECT val FROM counter WHERE id = ?').get('c1') as { val: number };
      assert.equal(rowAfterCommit.val, 15);

      // Failing transaction rolls back
      assert.throws(
        () => {
          conn.transaction(() => {
            conn.prepare('UPDATE counter SET val = val + 100 WHERE id = ?').run('c1');
            throw new Error('Forced transaction failure');
          });
        },
        /Forced transaction failure/
      );

      const rowAfterRollback = conn.prepare('SELECT val FROM counter WHERE id = ?').get('c1') as { val: number };
      assert.equal(rowAfterRollback.val, 15, 'Value must remain 15 after rollback');
    } finally {
      conn.close();
    }
  });
});
