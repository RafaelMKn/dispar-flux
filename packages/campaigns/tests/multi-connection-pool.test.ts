import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MultiConnectionPoolService } from '../src/engine/multi-connection-pool.js';
import {
  CampaignEngineError,
  ConnectionNotFoundError,
  CrossTenantViolationError,
  NoAvailableConnectionError,
  PoolNotFoundError,
} from '../src/errors.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('MultiConnectionPoolService (Issue #8 / ADR 0027)', () => {
  let ctx: SeededTestContext;
  let poolService: MultiConnectionPoolService;
  const orgId = 'org-test-1';
  const otherOrgId = 'org-other-tenant';

  beforeEach(() => {
    ctx = createTestDatabase();
    poolService = new MultiConnectionPoolService(ctx.conn);

    const now = new Date().toISOString();
    // Seed another organization for cross-tenant checks
    ctx.conn.prepare(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES (?, ?, 'America/Sao_Paulo', ?, ?)
    `).run(otherOrgId, 'Outra Empresa', now, now);

    // Seed additional connections in orgId
    ctx.conn.prepare(`
      INSERT INTO messaging_connections (id, organization_id, name, provider, status, created_at, updated_at)
      VALUES (?, ?, ?, 'baileys', 'connected', ?, ?),
             (?, ?, ?, 'baileys', 'connected', ?, ?),
             (?, ?, ?, 'baileys', 'disconnected', ?, ?)
    `).run(
      'conn-test-2', orgId, 'Linha 2', now, now,
      'conn-test-3', orgId, 'Linha 3', now, now,
      'conn-test-disc', orgId, 'Linha Caida', now, now
    );

    // Seed connection in otherOrgId
    ctx.conn.prepare(`
      INSERT INTO messaging_connections (id, organization_id, name, provider, status, created_at, updated_at)
      VALUES (?, ?, 'Linha Outro Tenant', 'baileys', 'connected', ?, ?)
    `).run('conn-other-tenant', otherOrgId, now, now);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('creates and lists connection pools', () => {
    const pool = poolService.createPool(orgId, 'Pool Vendas', [ctx.connectionId, 'conn-test-2']);
    assert.ok(pool.id);
    assert.equal(pool.name, 'Pool Vendas');
    assert.equal(pool.organizationId, orgId);

    const pools = poolService.listPools(orgId);
    assert.equal(pools.length, 1);
    assert.equal(pools[0]?.id, pool.id);

    const members = poolService.getPoolMembers(orgId, pool.id);
    assert.equal(members.length, 2);
    assert.deepEqual(
      members.map((m) => m.connectionId).sort(),
      [ctx.connectionId, 'conn-test-2'].sort()
    );
  });

  it('rejects pool creation with empty name', () => {
    assert.throws(
      () => poolService.createPool(orgId, '   '),
      (err: any) => err instanceof CampaignEngineError && err.code === 'INVALID_POOL_NAME'
    );
  });

  it('enforces multi-tenant isolation on pool creation', () => {
    assert.throws(
      () => poolService.createPool(orgId, 'Pool Invalido', ['conn-other-tenant']),
      (err: any) => err instanceof CrossTenantViolationError
    );
  });

  it('enforces multi-tenant isolation when adding members', () => {
    const pool = poolService.createPool(orgId, 'Pool Tenant', [ctx.connectionId]);

    // Attempt to add a connection from other organization
    assert.throws(
      () => poolService.addMember(orgId, pool.id, 'conn-other-tenant'),
      (err: any) => err instanceof CrossTenantViolationError
    );

    // Other org cannot add members or view pool
    assert.throws(
      () => poolService.addMember(otherOrgId, pool.id, 'conn-other-tenant'),
      (err: any) => err instanceof PoolNotFoundError
    );
  });

  it('adds and removes members from pool', () => {
    const pool = poolService.createPool(orgId, 'Pool Dinamico');
    assert.equal(poolService.getPoolMembers(orgId, pool.id).length, 0);

    poolService.addMember(orgId, pool.id, ctx.connectionId);
    poolService.addMember(orgId, pool.id, 'conn-test-2');
    assert.equal(poolService.getPoolMembers(orgId, pool.id).length, 2);

    poolService.removeMember(orgId, pool.id, ctx.connectionId);
    const updated = poolService.getPoolMembers(orgId, pool.id);
    assert.equal(updated.length, 1);
    assert.equal(updated[0]?.connectionId, 'conn-test-2');
  });

  it('deletes pool and removes cursor state', () => {
    const pool = poolService.createPool(orgId, 'Pool Para Deletar', [ctx.connectionId]);
    assert.ok(poolService.getPool(orgId, pool.id));

    const deleted = poolService.deletePool(orgId, pool.id);
    assert.equal(deleted, true);
    assert.equal(poolService.getPool(orgId, pool.id), null);
    assert.equal(poolService.listPools(orgId).length, 0);
  });

  it('performs round-robin selection among healthy connections', () => {
    const pool = poolService.createPool(orgId, 'Pool RR', [
      ctx.connectionId, // conn-test-1 (connected)
      'conn-test-2',    // connected
      'conn-test-3',    // connected
    ]);

    const first = poolService.selectNextConnection(orgId, pool.id);
    const second = poolService.selectNextConnection(orgId, pool.id);
    const third = poolService.selectNextConnection(orgId, pool.id);
    const fourth = poolService.selectNextConnection(orgId, pool.id);

    assert.equal(first, 'conn-test-1');
    assert.equal(second, 'conn-test-2');
    assert.equal(third, 'conn-test-3');
    assert.equal(fourth, 'conn-test-1'); // cycles back
  });

  it('skips disconnected members in round-robin', () => {
    const pool = poolService.createPool(orgId, 'Pool Com Queda', [
      ctx.connectionId,  // conn-test-1 (connected)
      'conn-test-disc',  // disconnected
      'conn-test-2',     // connected
    ]);

    const first = poolService.selectNextConnection(orgId, pool.id);
    const second = poolService.selectNextConnection(orgId, pool.id);
    const third = poolService.selectNextConnection(orgId, pool.id);

    assert.equal(first, 'conn-test-1');
    assert.equal(second, 'conn-test-2'); // skips conn-test-disc
    assert.equal(third, 'conn-test-1');  // cycles back
  });

  it('throws NoAvailableConnectionError when all members are disconnected', () => {
    const pool = poolService.createPool(orgId, 'Pool Sem Conexao', ['conn-test-disc']);

    assert.throws(
      () => poolService.selectNextConnection(orgId, pool.id),
      (err: any) => err instanceof NoAvailableConnectionError
    );
  });

  it('distributes batch of jobs across pool members', () => {
    const pool = poolService.createPool(orgId, 'Pool Distribuidor', [
      ctx.connectionId,
      'conn-test-2',
    ]);

    const jobs = ['lead-1', 'lead-2', 'lead-3', 'lead-4'];
    const distributed = poolService.distributeJobs(orgId, pool.id, jobs);

    assert.equal(distributed.length, 4);
    assert.equal(distributed[0]?.connectionId, 'conn-test-1');
    assert.equal(distributed[0]?.job, 'lead-1');
    assert.equal(distributed[1]?.connectionId, 'conn-test-2');
    assert.equal(distributed[1]?.job, 'lead-2');
    assert.equal(distributed[2]?.connectionId, 'conn-test-1');
    assert.equal(distributed[2]?.job, 'lead-3');
    assert.equal(distributed[3]?.connectionId, 'conn-test-2');
    assert.equal(distributed[3]?.job, 'lead-4');
  });
});
