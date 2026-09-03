import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import { DatabaseConnection, InstallationLock, InstallationLockedError } from '@dispar-flux/database';
import { DisparServer } from '@dispar-flux/server';

describe('Phase 1 Gate: Fundação Executável', () => {
  const testRunId = `gate1_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tempBase = path.join(os.tmpdir(), testRunId);

  // Helper to ensure clean temp dir
  function createTempDir(suffix) {
    const dir = path.join(tempBase, suffix);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('[P1-1: Deployment Artifacts]: Dockerfile, compose.yaml, Caddyfile, and install.sh exist and are valid', () => {
    const repoRoot = process.cwd();
    const dockerfilePath = path.join(repoRoot, 'Dockerfile');
    const composePath = path.join(repoRoot, 'deploy', 'compose.yaml');
    const caddyfilePath = path.join(repoRoot, 'deploy', 'Caddyfile');
    const installShPath = path.join(repoRoot, 'deploy', 'install.sh');

    assert.ok(fs.existsSync(dockerfilePath), 'Dockerfile must exist');
    const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');
    assert.match(dockerfile, /FROM node:22/i, 'Dockerfile must use Node 22 base');
    assert.match(dockerfile, /VOLUME \["\/data"\]/, 'Dockerfile must declare /data volume');
    assert.match(dockerfile, /EXPOSE 3000/, 'Dockerfile must expose port 3000');

    assert.ok(fs.existsSync(composePath), 'deploy/compose.yaml must exist');
    const compose = fs.readFileSync(composePath, 'utf-8');
    assert.match(compose, /services:/, 'compose.yaml must define services');
    assert.match(compose, /dispar-flux-data:\/data/, 'compose.yaml must mount persistent volume');
    assert.match(compose, /caddy:/, 'compose.yaml must define Caddy reverse proxy service');

    assert.ok(fs.existsSync(caddyfilePath), 'deploy/Caddyfile must exist');
    const caddyfile = fs.readFileSync(caddyfilePath, 'utf-8');
    assert.match(caddyfile, /reverse_proxy/, 'Caddyfile must configure reverse proxy');
    assert.match(caddyfile, /dispar-flux:3000/, 'Caddyfile must proxy to dispar-flux:3000');

    assert.ok(fs.existsSync(installShPath), 'deploy/install.sh must exist');
    const installSh = fs.readFileSync(installShPath, 'utf-8');
    assert.match(installSh, /docker/i, 'install.sh must validate docker');
    assert.match(installSh, /compose/i, 'install.sh must validate compose');
  });

  it('[P1-2: Web Frontend Build]: apps/web builds and produces production assets', () => {
    const distHtml = path.join(process.cwd(), 'apps', 'web', 'dist', 'index.html');
    assert.ok(fs.existsSync(distHtml), 'apps/web/dist/index.html must exist after build');
    const html = fs.readFileSync(distHtml, 'utf-8');
    assert.match(html, /Dispar Flux/i, 'HTML must contain Dispar Flux branding');
  });

  it('[P1-3: Server Lifecycle & Endpoints]: Server starts, responds to /health, /ready, /api/v1/system/status, and /ws', async () => {
    const dataDir = createTempDir('lifecycle');
    const server = new DisparServer({
      port: 0,
      host: '127.0.0.1',
      dataDir,
      nodeEnv: 'test',
      version: '0.0.1',
    });

    await server.start();
    try {
      // 1. Health check
      const healthRes = await fetch(`${server.url}/health`);
      assert.equal(healthRes.status, 200);
      const health = await healthRes.json();
      assert.equal(health.status, 'ok');
      assert.equal(health.version, '0.0.1');

      // 2. Ready check
      const readyRes = await fetch(`${server.url}/ready`);
      assert.equal(readyRes.status, 200);
      const ready = await readyRes.json();
      assert.equal(ready.status, 'ready');
      assert.equal(ready.database, 'connected');
      assert.equal(ready.storage, 'ready');
      assert.equal(ready.checks.lock, true);

      // 3. System status
      const statusRes = await fetch(`${server.url}/api/v1/system/status`);
      assert.equal(statusRes.status, 200);
      const status = await statusRes.json();
      assert.equal(status.edition, 'community');
      assert.equal(typeof status.installationId, 'string');

      // 4. OpenAPI
      const openApiRes = await fetch(`${server.url}/api/v1/openapi.json`);
      assert.equal(openApiRes.status, 200);
      const openApi = await openApiRes.json();
      assert.equal(openApi.openapi, '3.1.0');

      // 5. WebSocket
      const ws = new WebSocket(server.wsUrl);
      const wsMessagePromise = new Promise((resolve, reject) => {
        ws.on('message', (raw) => {
          try {
            resolve(JSON.parse(raw.toString()));
          } catch (err) {
            reject(err);
          }
        });
        ws.on('error', reject);
      });

      const firstWsEvent = await wsMessagePromise;
      assert.equal(firstWsEvent.type, 'system.status_changed');
      assert.equal(firstWsEvent.payload.status, 'connected');
      ws.close();
    } finally {
      await server.stop();
    }
  });

  it('[P1-4: Data Persistence Across Restart]: Data persisted to SQLite WAL survives complete server shutdown and restart', async () => {
    const dataDir = createTempDir('persistence');
    const orgId = `org_persist_${Date.now()}`;
    const orgName = 'Empresa Teste Persistência';

    // Run 1: Start server, insert data
    {
      const server1 = new DisparServer({
        port: 0,
        host: '127.0.0.1',
        dataDir,
        nodeEnv: 'test',
        version: '0.0.1',
      });
      await server1.start();

      const db = server1.database;
      db.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, retention_policy_messages_days, retention_policy_media_days, retention_policy_logs_days, created_at, updated_at)
        VALUES (?, ?, 'America/Sao_Paulo', 365, 90, 30, datetime('now'), datetime('now'))
      `).run(orgId, orgName);

      const count = db.prepare('SELECT COUNT(*) as count FROM organizations WHERE id = ?').get(orgId);
      assert.equal(count.count, 1);

      // Verify WAL file exists or database is in WAL mode
      const pragma = db.getPragma('journal_mode');
      assert.equal(pragma, 'wal');

      // Clean shutdown
      await server1.stop();
    }

    // Verify lock is cleanly released after shutdown
    const lockPath = path.join(dataDir, 'instance.lock');
    assert.ok(!fs.existsSync(lockPath), 'instance.lock must be removed after clean shutdown');

    // Run 2: Restart server on the exact same data directory
    {
      const server2 = new DisparServer({
        port: 0,
        host: '127.0.0.1',
        dataDir,
        nodeEnv: 'test',
        version: '0.0.1',
      });
      await server2.start();

      try {
        const db = server2.database;
        const orgRow = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
        assert.ok(orgRow, 'Organization record must persist after restart');
        assert.equal(orgRow.name, orgName);

        // System status should now indicate isClaimed = true
        const statusRes = await fetch(`${server2.url}/api/v1/system/status`);
        assert.equal(statusRes.status, 200);
        const status = await statusRes.json();
        assert.equal(status.isClaimed, true);
      } finally {
        await server2.stop();
      }
    }
  });

  it('[P1-5: Second Runtime Rejection]: A second server instance on the same data directory is strictly rejected', async () => {
    const dataDir = createTempDir('lock_rejection');

    // Start primary server instance
    const primaryServer = new DisparServer(
      {
        port: 0,
        host: '127.0.0.1',
        dataDir,
        nodeEnv: 'test',
        version: '0.0.1',
      },
      { exitOnLockError: false }
    );
    await primaryServer.start();

    try {
      // Confirm lock file is active
      const lockPath = path.join(dataDir, 'instance.lock');
      assert.ok(fs.existsSync(lockPath), 'instance.lock must exist while primary is active');

      // Attempt to start a secondary server on the exact same data directory
      const secondaryServer = new DisparServer(
        {
          port: 0,
          host: '127.0.0.1',
          dataDir,
          nodeEnv: 'test',
          version: '0.0.1',
        },
        { exitOnLockError: false }
      );

      await assert.rejects(
        async () => {
          await secondaryServer.start();
        },
        (err) => {
          assert.ok(err instanceof InstallationLockedError);
          assert.equal(err.pid, process.pid);
          return true;
        },
        'Secondary server must be rejected with InstallationLockedError'
      );
    } finally {
      await primaryServer.stop();
    }

    // Verify lock is released and a new server can now start
    const successorServer = new DisparServer(
      {
        port: 0,
        host: '127.0.0.1',
        dataDir,
        nodeEnv: 'test',
        version: '0.0.1',
      },
      { exitOnLockError: false }
    );
    await successorServer.start();
    await successorServer.stop();
  });
});
