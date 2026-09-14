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

  const EXPECTED_BLOCKS_ABC_TABLES = [
    'ai_configs',
    'connection_pools',
    'connection_pool_members',
    'maturation_state',
    'webhook_subscriptions',
    'webhook_deliveries',
  ];

  it('runs initial and blocks A/B/C schema migrations and creates all required tables', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      const migrator = new Migrator(conn);
      const applied = migrator.migrate();

      assert.ok(applied.length >= 2, 'At least 2 migrations should be applied');
      assert.equal(applied[0]?.name, '0001_initial_schema.sql');
      assert.equal(applied[1]?.name, '0002_blocks_a_b_c_schema.sql');

      // Verify _migrations tracking table
      const appliedRecords = migrator.getAppliedMigrations();
      assert.equal(appliedRecords.length, applied.length);
      assert.equal(appliedRecords[0]?.name, '0001_initial_schema.sql');
      assert.equal(appliedRecords[1]?.name, '0002_blocks_a_b_c_schema.sql');

      // Query sqlite_master to verify all tables exist
      const tables = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'"
      ).all() as { name: string }[];

      const tableNames = new Set(tables.map((t) => t.name));

      for (const expectedTable of EXPECTED_20_TABLES) {
        assert.ok(tableNames.has(expectedTable), `Expected table "${expectedTable}" to exist in schema`);
      }

      for (const expectedTable of EXPECTED_BLOCKS_ABC_TABLES) {
        assert.ok(tableNames.has(expectedTable), `Expected Blocks A/B/C table "${expectedTable}" to exist in schema`);
      }

      assert.equal(EXPECTED_20_TABLES.length, 20, 'Specification must define exactly 20 initial tables');
      assert.equal(EXPECTED_BLOCKS_ABC_TABLES.length, 6, 'Blocks A, B, C must define exactly 6 new tables');
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

  it('validates Blocks A, B, and C tables schema, default values, and indexes', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      runMigrations(conn);

      // Verify all indexes exist
      const indexes = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"
      ).all() as { name: string }[];
      const indexNames = new Set(indexes.map((i) => i.name));

      const expectedIndexes = [
        'idx_ai_configs_org',
        'idx_connection_pools_org',
        'idx_pool_members_conn',
        'idx_webhook_subs_org',
        'idx_webhook_deliv_sub',
        'idx_webhook_deliv_state',
      ];

      for (const expectedIndex of expectedIndexes) {
        assert.ok(indexNames.has(expectedIndex), `Expected index "${expectedIndex}" to exist`);
      }

      const now = new Date().toISOString();
      const orgId = 'org-test-abc';
      const connId = 'conn-test-abc';

      // Setup org and connection
      conn.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(orgId, 'Org ABC', 'America/Sao_Paulo', now, now);

      conn.prepare(`
        INSERT INTO messaging_connections (id, organization_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(connId, orgId, 'Conn Primary', now, now);

      // Test ai_configs defaults
      conn.prepare(`
        INSERT INTO ai_configs (id, organization_id, provider, model_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ai-1', orgId, 'gemini', 'gemini-1.5-pro', now, now);

      const aiConfig = conn.prepare('SELECT * FROM ai_configs WHERE id = ?').get('ai-1') as {
        operational_rules_json: string;
        api_key_ciphertext: string | null;
      };
      assert.equal(aiConfig.operational_rules_json, '{}');
      assert.equal(aiConfig.api_key_ciphertext, null);

      // Test maturation_state defaults
      conn.prepare(`
        INSERT INTO maturation_state (connection_id, last_evaluated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(connId, now, now, now);

      const matState = conn.prepare('SELECT * FROM maturation_state WHERE connection_id = ?').get(connId) as {
        current_day: number;
        stage: string;
        sent_today: number;
        daily_cap: number;
        report_count_24h: number;
      };
      assert.equal(matState.current_day, 1);
      assert.equal(matState.stage, 'birth');
      assert.equal(matState.sent_today, 0);
      assert.equal(matState.daily_cap, 0);
      assert.equal(matState.report_count_24h, 0);

      // Test webhook_subscriptions defaults
      conn.prepare(`
        INSERT INTO webhook_subscriptions (id, organization_id, target_url, secret_ciphertext, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('sub-1', orgId, 'https://example.com/webhook', 'secret_cipher', now, now);

      const sub = conn.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get('sub-1') as {
        events_json: string;
        is_active: number;
        failure_count: number;
      };
      assert.equal(sub.events_json, '[]');
      assert.equal(sub.is_active, 1);
      assert.equal(sub.failure_count, 0);

      // Test webhook_deliveries defaults
      conn.prepare(`
        INSERT INTO webhook_deliveries (id, subscription_id, event_name, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('deliv-1', 'sub-1', 'lead.created', '{"leadId":"1"}', now);

      const deliv = conn.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get('deliv-1') as {
        attempts: number;
        state: string;
        response_status: number | null;
        next_retry_at: string | null;
        delivered_at: string | null;
      };
      assert.equal(deliv.attempts, 0);
      assert.equal(deliv.state, 'pending');
      assert.equal(deliv.response_status, null);
      assert.equal(deliv.next_retry_at, null);
      assert.equal(deliv.delivered_at, null);
    } finally {
      conn.close();
    }
  });

  it('enforces CHECK constraints on Blocks A, B, and C tables', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      runMigrations(conn);

      const now = new Date().toISOString();
      const orgId = 'org-check-test';
      const connId = 'conn-check-test';

      conn.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(orgId, 'Org Checks', 'America/Sao_Paulo', now, now);

      conn.prepare(`
        INSERT INTO messaging_connections (id, organization_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(connId, orgId, 'Conn 1', now, now);

      // ai_configs: valid providers are gemini, openai, groq, ollama
      for (const validProvider of ['gemini', 'openai', 'groq', 'ollama']) {
        conn.prepare(`
          INSERT INTO ai_configs (id, organization_id, provider, model_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`ai-${validProvider}`, orgId, validProvider, 'model-x', now, now);
      }

      // Invalid provider should throw CHECK constraint error
      assert.throws(() => {
        conn.prepare(`
          INSERT INTO ai_configs (id, organization_id, provider, model_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run('ai-invalid', orgId, 'anthropic', 'claude-3', now, now);
      }, /CHECK constraint failed/i);

      // maturation_state: valid stages are birth, activation, expansion, consolidation, nominal
      for (const validStage of ['birth', 'activation', 'expansion', 'consolidation', 'nominal']) {
        const stageConnId = `conn-stage-${validStage}`;
        conn.prepare(`
          INSERT INTO messaging_connections (id, organization_id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(stageConnId, orgId, `Conn ${validStage}`, now, now);

        conn.prepare(`
          INSERT INTO maturation_state (connection_id, stage, last_evaluated_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(stageConnId, validStage, now, now, now);
      }

      // Invalid maturation stage should throw CHECK constraint error
      const badStageConnId = 'conn-bad-stage';
      conn.prepare(`
        INSERT INTO messaging_connections (id, organization_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(badStageConnId, orgId, 'Bad Conn', now, now);

      assert.throws(() => {
        conn.prepare(`
          INSERT INTO maturation_state (connection_id, stage, last_evaluated_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(badStageConnId, 'graduated', now, now, now);
      }, /CHECK constraint failed/i);

      // webhook_subscriptions: is_active must be 0 or 1
      assert.throws(() => {
        conn.prepare(`
          INSERT INTO webhook_subscriptions (id, organization_id, target_url, secret_ciphertext, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('sub-invalid', orgId, 'https://example.com', 'secret', 2, now, now);
      }, /CHECK constraint failed/i);

      // webhook_deliveries: state must be pending, success, failed
      conn.prepare(`
        INSERT INTO webhook_subscriptions (id, organization_id, target_url, secret_ciphertext, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('sub-valid', orgId, 'https://example.com', 'secret', now, now);

      for (const validState of ['pending', 'success', 'failed']) {
        conn.prepare(`
          INSERT INTO webhook_deliveries (id, subscription_id, event_name, payload_json, state, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`deliv-${validState}`, 'sub-valid', 'test.event', '{}', validState, now);
      }

      assert.throws(() => {
        conn.prepare(`
          INSERT INTO webhook_deliveries (id, subscription_id, event_name, payload_json, state, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run('deliv-bad-state', 'sub-valid', 'test.event', '{}', 'in_transit', now);
      }, /CHECK constraint failed/i);
    } finally {
      conn.close();
    }
  });

  it('enforces foreign key cascading deletions across Blocks A, B, and C tables', () => {
    const conn = openDatabase({ filePath: ':memory:' });
    try {
      runMigrations(conn);

      const now = new Date().toISOString();
      const orgId = 'org-cascade-test';
      const connId = 'conn-cascade-test';
      const poolId = 'pool-cascade-test';
      const subId = 'sub-cascade-test';

      // Seed organization and messaging_connection
      conn.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(orgId, 'Org Cascade', 'America/Sao_Paulo', now, now);

      conn.prepare(`
        INSERT INTO messaging_connections (id, organization_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(connId, orgId, 'Conn Cascade', now, now);

      // Seed Blocks A, B, C records
      conn.prepare(`
        INSERT INTO ai_configs (id, organization_id, provider, model_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('ai-c1', orgId, 'openai', 'gpt-4o', now, now);

      conn.prepare(`
        INSERT INTO connection_pools (id, organization_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(poolId, orgId, 'Pool Alpha', now, now);

      conn.prepare(`
        INSERT INTO connection_pool_members (pool_id, connection_id, created_at)
        VALUES (?, ?, ?)
      `).run(poolId, connId, now);

      conn.prepare(`
        INSERT INTO maturation_state (connection_id, last_evaluated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(connId, now, now, now);

      conn.prepare(`
        INSERT INTO webhook_subscriptions (id, organization_id, target_url, secret_ciphertext, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(subId, orgId, 'https://example.com/wh', 'sec', now, now);

      conn.prepare(`
        INSERT INTO webhook_deliveries (id, subscription_id, event_name, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('deliv-c1', subId, 'lead.created', '{}', now);

      // Test primary key constraint on connection_pool_members
      assert.throws(() => {
        conn.prepare(`
          INSERT INTO connection_pool_members (pool_id, connection_id, created_at)
          VALUES (?, ?, ?)
        `).run(poolId, connId, now);
      }, /UNIQUE constraint failed|PRIMARY KEY constraint failed/i);

      // Test primary key constraint on maturation_state
      assert.throws(() => {
        conn.prepare(`
          INSERT INTO maturation_state (connection_id, last_evaluated_at, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(connId, now, now, now);
      }, /UNIQUE constraint failed|PRIMARY KEY constraint failed/i);

      // Deleting webhook_subscription cascades to webhook_deliveries
      conn.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').run(subId);
      assert.equal(conn.prepare('SELECT COUNT(*) as cnt FROM webhook_deliveries WHERE id = ?').get('deliv-c1')?.cnt, 0);

      // Deleting connection_pool cascades to connection_pool_members
      conn.prepare('DELETE FROM connection_pools WHERE id = ?').run(poolId);
      assert.equal(conn.prepare('SELECT COUNT(*) as cnt FROM connection_pool_members WHERE pool_id = ?').get(poolId)?.cnt, 0);

      // Deleting messaging_connection cascades to maturation_state
      conn.prepare('DELETE FROM messaging_connections WHERE id = ?').run(connId);
      assert.equal(conn.prepare('SELECT COUNT(*) as cnt FROM maturation_state WHERE connection_id = ?').get(connId)?.cnt, 0);

      // Deleting organization cascades to ai_configs
      conn.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);
      assert.equal(conn.prepare('SELECT COUNT(*) as cnt FROM ai_configs WHERE id = ?').get('ai-c1')?.cnt, 0);
    } finally {
      conn.close();
    }
  });
});
