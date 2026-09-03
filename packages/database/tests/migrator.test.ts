import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, Migrator, runMigrations, MigrationError } from '../src/index.js';

describe('Database: Migrator & Initial Schema', () => {
  const EXPECTED_20_TABLES = [
    'organizations',
    'members',
    'authorized_devices',
    'sessions',
    'access_invites',
    'messaging_connections',
    'contacts',
    'bases',
    'base_memberships',
    'campaigns',
    'campaign_jobs',
    'conversations',
    'messages',
    'funnels',
    'leads',
    'opt_outs',
    'suppression_keys',
    'audit_records',
    'service_accounts',
    'webhooks',
  ];

  it('runs initial schema migration and creates all 20 required tables', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      const migrator = new Migrator(conn);
      const applied = migrator.migrate();

      assert.ok(applied.length >= 1, 'At least 1 migration should be applied');
      assert.equal(applied[0]?.name, '0001_initial_schema.sql');

      // Verify _migrations tracking table
      const appliedRecords = migrator.getAppliedMigrations();
      assert.equal(appliedRecords.length, applied.length);
      assert.equal(appliedRecords[0]?.name, '0001_initial_schema.sql');

      // Query sqlite_master to verify all 20 tables exist
      const tables = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'"
      ).all() as { name: string }[];

      const tableNames = new Set(tables.map((t) => t.name));

      for (const expectedTable of EXPECTED_20_TABLES) {
        assert.ok(tableNames.has(expectedTable), `Expected table "${expectedTable}" to exist in schema`);
      }

      assert.equal(EXPECTED_20_TABLES.length, 20, 'Specification must define exactly 20 tables');
    } finally {
      conn.close();
    }
  });

  it('is idempotent: running migrations again does not re-apply existing migrations', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      const migrator = new Migrator(conn);
      const firstRun = migrator.migrate();
      assert.ok(firstRun.length > 0);

      const secondRun = migrator.migrate();
      assert.equal(secondRun.length, 0, 'Second migration run should apply 0 migrations');

      const pending = migrator.getPendingMigrations();
      assert.equal(pending.length, 0, 'No pending migrations should remain');
    } finally {
      conn.close();
    }
  });

  it('executes migrations in strict lexical order', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      const customMigrations = [
        {
          name: '0002_add_secondary_table.sql',
          sql: 'CREATE TABLE t_second (id TEXT PRIMARY KEY, first_id TEXT REFERENCES t_first(id));',
        },
        {
          name: '0001_add_first_table.sql',
          sql: 'CREATE TABLE t_first (id TEXT PRIMARY KEY, val TEXT);',
        },
      ];

      const migrator = new Migrator(conn, { migrations: customMigrations });
      const applied = migrator.migrate();

      assert.equal(applied.length, 2);
      assert.equal(applied[0]?.name, '0001_add_first_table.sql');
      assert.equal(applied[1]?.name, '0002_add_secondary_table.sql');

      const records = migrator.getAppliedMigrations();
      assert.equal(records[0]?.name, '0001_add_first_table.sql');
      assert.equal(records[1]?.name, '0002_add_secondary_table.sql');
    } finally {
      conn.close();
    }
  });

  it('rolls back and preserves integrity when a migration contains invalid SQL', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      const badMigrations = [
        {
          name: '0001_valid.sql',
          sql: 'CREATE TABLE t_valid (id TEXT PRIMARY KEY);',
        },
        {
          name: '0002_invalid.sql',
          sql: 'CREATE TABLE t_invalid (id TEXT PRIMARY KEY); INVALID SQL SYNTAX HERE;',
        },
      ];

      const migrator = new Migrator(conn, { migrations: badMigrations });

      assert.throws(
        () => {
          migrator.migrate();
        },
        (err: unknown) => {
          return err instanceof MigrationError && err.migrationName === '0002_invalid.sql';
        }
      );

      // The first valid migration should be applied
      const applied = migrator.getAppliedMigrations();
      assert.equal(applied.length, 1);
      assert.equal(applied[0]?.name, '0001_valid.sql');

      // Table from second migration must NOT exist due to rollback
      const tableCheck = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 't_invalid'"
      ).get();
      assert.equal(tableCheck, undefined, 't_invalid table must have been rolled back');
    } finally {
      conn.close();
    }
  });

  it('allows inserting valid domain entity data into the migrated schema', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      runMigrations(conn);

      const now = new Date().toISOString();
      const orgId = 'org-test-1';
      const memberId = 'mem-test-1';

      // Insert organization
      conn.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(orgId, 'Test Empresa', 'America/Sao_Paulo', now, now);

      // Insert member
      conn.prepare(`
        INSERT INTO members (id, organization_id, name, email, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(memberId, orgId, 'Rafael Admin', 'rafael@empresa.com', 'owner', 1, now, now);

      // Query and verify
      const member = conn.prepare('SELECT * FROM members WHERE id = ?').get(memberId) as {
        id: string;
        name: string;
        email: string;
        role: string;
        organization_id: string;
      };

      assert.equal(member.name, 'Rafael Admin');
      assert.equal(member.email, 'rafael@empresa.com');
      assert.equal(member.role, 'owner');
      assert.equal(member.organization_id, orgId);
    } finally {
      conn.close();
    }
  });
});
