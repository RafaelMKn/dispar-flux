import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from './test-helper.js';
import { AuditLogger } from '../src/audit/audit-logger.js';

describe('Essential Audit Logger (ADR 0030, 0050)', () => {
  it('logs essential audit events, sanitizes sensitive keys, and queries records', () => {
    const ctx = createTestContext();
    try {
      const logger = new AuditLogger(ctx.db);
      const orgId = 'org-audit-123';
      const now = new Date().toISOString();

      // Insert organization to satisfy foreign key constraint
      ctx.db.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
        VALUES (?, 'Audit Org', 'America/Sao_Paulo', ?, ?)
      `).run(orgId, now, now);

      // 1. Log an event with sensitive metadata that must be redacted
      const record = logger.log({
        organizationId: orgId,
        actorType: 'member',
        actorId: 'member-456',
        action: 'auth.login',
        targetType: 'device',
        targetId: 'device-789',
        metadata: {
          ip: '127.0.0.1',
          client: 'Chrome',
          password: 'PlainSecretPassword!', // Must be redacted
          token: 'sensitive-raw-token', // Must be redacted
          tokenHash: 'hash123', // Must be redacted
        },
      });

      assert.ok(record.id);
      assert.equal(record.action, 'auth.login');
      assert.equal(record.metadata?.['ip'], '127.0.0.1');
      assert.equal(record.metadata?.['client'], 'Chrome');
      assert.equal(record.metadata?.['password'], '[REDACTED]');
      assert.equal(record.metadata?.['token'], '[REDACTED]');
      assert.equal(record.metadata?.['tokenHash'], '[REDACTED]');

      // 2. Query logged records
      const results = logger.query(orgId, { action: 'auth.login' });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.targetId, 'device-789');
      assert.equal(results[0]?.metadata?.['password'], '[REDACTED]');
    } finally {
      ctx.cleanup();
    }
  });
});
