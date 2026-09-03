import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WebSocket } from 'ws';
import { InstallationLock, InstallationLockedError } from '@dispar-flux/database';
import { createWebSocketEvent } from '@dispar-flux/contracts';
import { DisparServer } from '../src/server.js';
import { Logger } from '../src/logger.js';

// Silent logger for tests to avoid cluttering test reporter
const silentLogger = new Logger({
  level: 'error',
  output: () => {},
});

describe('Dispar Flux Server: Core Integration Tests', () => {
  let tempDir: string;
  let server: DisparServer;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-srv-test-'));
    server = new DisparServer(
      {
        port: 0, // Ephemeral port
        host: '127.0.0.1',
        dataDir: tempDir,
        nodeEnv: 'test',
        version: '0.0.1',
      },
      {
        logger: silentLogger,
        exitOnLockError: false,
      }
    );
    await server.start();
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  it('GET /health returns 200 and valid HealthResponse JSON', async () => {
    const res = await fetch(`${server.url}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);

    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(typeof data.uptimeSeconds, 'number');
    assert.ok(data.uptimeSeconds >= 0);
    assert.equal(data.version, '0.0.1');
    assert.ok(!isNaN(Date.parse(data.timestamp)));

    // Route alias /api/v1/health
    const aliasRes = await fetch(`${server.url}/api/v1/health`);
    assert.equal(aliasRes.status, 200);
    const aliasData = await aliasRes.json();
    assert.equal(aliasData.status, 'ok');
  });

  it('GET /ready returns 200 when DB and lock are active', async () => {
    const res = await fetch(`${server.url}/ready`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);

    const data = await res.json();
    assert.equal(data.status, 'ready');
    assert.equal(data.database, 'connected');
    assert.equal(data.storage, 'ready');
    assert.equal(data.checks['database'], true);
    assert.equal(data.checks['lock'], true);
    assert.equal(data.checks['storage'], true);
    assert.ok(!isNaN(Date.parse(data.timestamp)));

    // Route alias /api/v1/ready
    const aliasRes = await fetch(`${server.url}/api/v1/ready`);
    assert.equal(aliasRes.status, 200);
    const aliasData = await aliasRes.json();
    assert.equal(aliasData.status, 'ready');
  });

  it('GET /api/v1/system/status returns valid SystemStatusResponse payload', async () => {
    const res = await fetch(`${server.url}/api/v1/system/status`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);

    const data = await res.json();
    assert.ok(typeof data.installationId === 'string' && data.installationId.startsWith('inst_'));
    assert.equal(data.version, '0.0.1');
    assert.equal(data.edition, 'community');
    assert.equal(data.environment, 'test');
    assert.equal(data.operationalTimezone, 'America/Sao_Paulo');
    assert.equal(typeof data.uptimeSeconds, 'number');
    assert.equal(data.nodeVersion, process.version);
    assert.equal(data.isClaimed, false);
    assert.equal(data.activeConnectionsCount, 0);
    assert.equal(data.storageType, 'local');

    // Test that claiming reflects in status
    server.db!.exec(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES ('org_test_1', 'Org Alpha', 'America/Recife', datetime('now'), datetime('now'));
    `);

    const claimedRes = await fetch(`${server.url}/api/v1/system/status`);
    assert.equal(claimedRes.status, 200);
    const claimedData = await claimedRes.json();
    assert.equal(claimedData.isClaimed, true);
    assert.equal(claimedData.operationalTimezone, 'America/Recife');
  });

  it('GET /api/v1/openapi.json returns valid OpenAPI 3.1 document', async () => {
    const res = await fetch(`${server.url}/api/v1/openapi.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);

    const data = await res.json();
    assert.equal(data.openapi, '3.1.0');
    assert.equal(data.info.title, 'Dispar Flux API');
    assert.ok(data.paths['/health']);
    assert.ok(data.paths['/ready']);
    assert.ok(data.paths['/system/status']);
    assert.ok(data.components.schemas['HealthResponse']);
    assert.ok(data.components.schemas['ReadyResponse']);
    assert.ok(data.components.schemas['SystemStatusResponse']);
  });

  it('GET /api/v1/docs serves HTML documentation with Swagger UI', async () => {
    const res = await fetch(`${server.url}/api/v1/docs`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);

    const html = await res.text();
    assert.ok(html.includes('swagger-ui'));
    assert.ok(html.includes('/api/v1/openapi.json'));
    assert.ok(html.includes('Dispar Flux API Documentation'));
  });

  it('WebSocket connects on /ws and receives welcome/status event, ping/pong, and broadcast', async () => {
    const ws = new WebSocket(server.wsUrl);

    // 1. Wait for connection and welcome event
    const welcomeEvent = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket welcome timeout')), 3000);
      ws.on('message', (raw) => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(raw.toString());
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    assert.equal(welcomeEvent.type, 'system.status_changed');
    assert.equal(welcomeEvent.payload.status, 'connected');
    assert.equal(welcomeEvent.payload.details.edition, 'community');

    // 2. Test application ping-pong
    const pongResponse = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Ping/Pong timeout')), 3000);
      ws.once('message', (raw) => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(raw.toString());
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    assert.equal(pongResponse.type, 'pong');
    assert.ok(pongResponse.timestamp);

    // 3. Test broadcast event delivery
    const broadcastPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Broadcast timeout')), 3000);
      ws.once('message', (raw) => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(raw.toString());
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });

    const testBroadcast = createWebSocketEvent('campaign.started', {
      campaignId: 'camp_100',
      status: 'running',
      sentCount: 0,
      failedCount: 0,
      unknownCount: 0,
      totalCount: 50,
      progressPercent: 0,
    });

    server.broadcast(testBroadcast);
    const receivedEvent = await broadcastPromise;
    assert.equal(receivedEvent.type, 'campaign.started');
    assert.equal(receivedEvent.payload.campaignId, 'camp_100');

    ws.close();
  });

  it('rejects starting a concurrent server on the same data directory due to InstallationLock', async () => {
    const collidingServer = new DisparServer(
      {
        port: 0,
        host: '127.0.0.1',
        dataDir: tempDir,
        nodeEnv: 'test',
      },
      {
        logger: silentLogger,
        exitOnLockError: false,
      }
    );

    await assert.rejects(
      async () => {
        await collidingServer.start();
      },
      (err: unknown) => {
        assert.ok(err instanceof InstallationLockedError);
        assert.equal(err.pid, process.pid);
        return true;
      }
    );
  });
});

describe('Dispar Flux Server: Graceful Shutdown & Readiness Failure Tests', () => {
  it('graceful shutdown closes resources and releases InstallationLock cleanly', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-shutdown-test-'));

    try {
      const server = new DisparServer(
        {
          port: 0,
          host: '127.0.0.1',
          dataDir: tempDir,
          nodeEnv: 'test',
        },
        {
          logger: silentLogger,
          exitOnLockError: false,
        }
      );

      await server.start();
      assert.equal(server.lock?.isHeld, true);
      const inspectedBefore = InstallationLock.inspect(tempDir);
      assert.equal(inspectedBefore.isLocked, true);

      // Stop server
      await server.stop();
      assert.equal(server.lock, null);

      // Inspect dataDir: lock should be released
      const inspectedAfter = InstallationLock.inspect(tempDir);
      assert.equal(inspectedAfter.isLocked, false);

      // A fresh server can now acquire lock on the same dataDir without collision
      const restartedServer = new DisparServer(
        {
          port: 0,
          host: '127.0.0.1',
          dataDir: tempDir,
          nodeEnv: 'test',
        },
        {
          logger: silentLogger,
          exitOnLockError: false,
        }
      );

      await restartedServer.start();
      assert.equal(restartedServer.lock?.isHeld, true);
      await restartedServer.stop();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  });

  it('GET /ready returns 503 when database is closed or in error', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-unready-test-'));

    try {
      const server = new DisparServer(
        {
          port: 0,
          host: '127.0.0.1',
          dataDir: tempDir,
          nodeEnv: 'test',
        },
        {
          logger: silentLogger,
          exitOnLockError: false,
        }
      );

      await server.start();

      // Close DB artificially to simulate database failure
      server.db?.close();

      const res = await fetch(`${server.url}/ready`);
      assert.equal(res.status, 503);

      const data = await res.json();
      assert.equal(data.status, 'not_ready');
      assert.equal(data.database, 'error');
      assert.equal(data.checks['database'], false);

      await server.stop();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  });
});
