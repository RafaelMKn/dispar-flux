import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createServer } from '../apps/server/dist/server.js';
import { readClaimToken } from '../packages/auth/dist/onboarding/claim-token.js';
import { EnterpriseLicenseManager, EnterpriseCloudBackupProvider } from '../packages/enterprise/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeTempDir(prefix = 'dispar-enterprise-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}

async function claimServer(server, address, dataDir, name = 'Enterprise User') {
  const claimCode = readClaimToken(dataDir);
  const claimRes = await fetch(`${address}/api/v1/auth/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      claimCode,
      organizationName: 'Enterprise Organization S/A',
      ownerName: name,
      ownerEmail: 'owner@enterprise.local',
      password: 'SuperSecurePassword123!',
      operationalTimezone: 'America/Sao_Paulo',
    }),
  });
  assert.equal(claimRes.status, 201);
  return await claimRes.json();
}

describe('Dispar Flux Enterprise Edition Gate Suite (ADR 0001, 0005, 0013, 0037, 0052, 0060)', { concurrency: 1 }, () => {
  it('[Criterion 1: Edition Reporting & Isolation]: Reports enterprise vs community correctly', async () => {
    // 1. Enterprise instance
    const entDir = makeTempDir('ent-report-');
    const entServer = createServer({ dataDir: entDir, port: 0, edition: 'enterprise' });
    const { address: entAddr } = await entServer.start();

    try {
      const res = await fetch(`${entAddr}/api/v1/system/status`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.edition, 'enterprise', 'Server must report edition enterprise when configured');
    } finally {
      await entServer.stop();
      cleanDir(entDir);
    }

    // 2. Community instance
    const comDir = makeTempDir('com-report-');
    const comServer = createServer({ dataDir: comDir, port: 0, edition: 'community' });
    const { address: comAddr } = await comServer.start();

    try {
      const res = await fetch(`${comAddr}/api/v1/system/status`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.edition, 'community', 'Default/community server must report edition community');
    } finally {
      await comServer.stop();
      cleanDir(comDir);
    }
  });

  it('[Criterion 2: Multi-Funnel CRM Support]: Multiple active funnels allowed in Enterprise, limited in Community (ADR 0037)', async () => {
    // 1. Test Enterprise Edition allows multiple funnels
    const entDir = makeTempDir('ent-funnel-');
    const entServer = createServer({ dataDir: entDir, port: 0, edition: 'enterprise' });
    const { address: entAddr } = await entServer.start();

    try {
      const claim = await claimServer(entServer, entAddr, entDir, 'Enterprise CRM Admin');
      const headers = {
        'Authorization': `Bearer ${claim.token}`,
        'Content-Type': 'application/json',
      };

      // Create Funnel 1
      const f1Res = await fetch(`${entAddr}/api/v1/crm/funnels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Funil Outbound Enterprise',
          stages: [
            { id: 's1', name: 'Prospectado', order: 0 },
            { id: 's2', name: 'Qualificado', order: 1 },
            { id: 's3', name: 'Contrato', order: 2 },
          ],
        }),
      });
      assert.equal(f1Res.status, 201, 'Funnel 1 creation must succeed in enterprise');
      const f1Data = await f1Res.json();
      assert.ok(f1Data.id);

      // Create Funnel 2 (MUST SUCCEED IN ENTERPRISE)
      const f2Res = await fetch(`${entAddr}/api/v1/crm/funnels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Funil Inbound Enterprise',
          stages: [
            { id: 'in1', name: 'Novo Lead', order: 0 },
            { id: 'in2', name: 'Reunião Marcada', order: 1 },
          ],
        }),
      });
      assert.equal(f2Res.status, 201, 'Second active funnel MUST be allowed in Enterprise edition (ADR 0037)');
      const f2Data = await f2Res.json();
      assert.ok(f2Data.id);

      // List funnels
      const listRes = await fetch(`${entAddr}/api/v1/crm/funnels`, { headers });
      assert.equal(listRes.status, 200);
      const listData = await listRes.json();
      assert.ok(listData.funnels.length >= 2, 'Should list multiple funnels');

      // Test Board by funnelId
      const boardRes = await fetch(`${entAddr}/api/v1/crm/board?funnelId=${f2Data.id}`, { headers });
      assert.equal(boardRes.status, 200);
      const boardData = await boardRes.json();
      assert.equal(boardData.funnelId, f2Data.id);
      assert.equal(boardData.funnelName, 'Funil Inbound Enterprise');
    } finally {
      await entServer.stop();
      cleanDir(entDir);
    }

    // 2. Test Community Edition strictly rejects second funnel
    const comDir = makeTempDir('com-funnel-');
    const comServer = createServer({ dataDir: comDir, port: 0, edition: 'community' });
    const { address: comAddr } = await comServer.start();

    try {
      const claim = await claimServer(comServer, comAddr, comDir, 'Community CRM Admin');
      const headers = {
        'Authorization': `Bearer ${claim.token}`,
        'Content-Type': 'application/json',
      };

      // In community, funnels list initializes default funnel (count = 1)
      await fetch(`${comAddr}/api/v1/crm/funnels`, { headers });

      // Attempting to create a second funnel in Community MUST be rejected with 403
      const badFunnelRes = await fetch(`${comAddr}/api/v1/crm/funnels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Tentativa Segundo Funil' }),
      });
      assert.equal(badFunnelRes.status, 403, 'Community edition must reject multiple funnels with 403');
      const errData = await badFunnelRes.json();
      assert.equal(errData.error, 'CommunityEditionFunnelLimitError');
    } finally {
      await comServer.stop();
      cleanDir(comDir);
    }
  });

  it('[Criterion 3: Multi-Connection Messaging Support]: Multiple connections allowed in Enterprise, limited in Community (ADR 0005 & 0013)', async () => {
    // 1. Enterprise Multi-Connection
    const entDir = makeTempDir('ent-conn-');
    const entServer = createServer({ dataDir: entDir, port: 0, edition: 'enterprise' });
    const { address: entAddr } = await entServer.start();

    try {
      const claim = await claimServer(entServer, entAddr, entDir, 'Enterprise Conn Admin');
      const headers = {
        'Authorization': `Bearer ${claim.token}`,
        'Content-Type': 'application/json',
      };

      // Create Connection 1
      const c1Res = await fetch(`${entAddr}/api/v1/connections`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Chip 1 - Vendas' }),
      });
      assert.equal(c1Res.status, 201);
      const c1Data = await c1Res.json();
      assert.ok(c1Data.id);

      // Create Connection 2 (MUST SUCCEED IN ENTERPRISE)
      const c2Res = await fetch(`${entAddr}/api/v1/connections`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Chip 2 - Suporte' }),
      });
      assert.equal(c2Res.status, 201, 'Second connection MUST succeed in Enterprise edition');
      const c2Data = await c2Res.json();
      assert.ok(c2Data.id);

      // List all connections
      const listRes = await fetch(`${entAddr}/api/v1/connections`, { headers });
      assert.equal(listRes.status, 200);
      const listData = await listRes.json();
      assert.ok(listData.connections.length >= 2, 'Must list at least 2 connections');
    } finally {
      await entServer.stop();
      cleanDir(entDir);
    }

    // 2. Community Edition Limit
    const comDir = makeTempDir('com-conn-');
    const comServer = createServer({ dataDir: comDir, port: 0, edition: 'community' });
    const { address: comAddr } = await comServer.start();

    try {
      const claim = await claimServer(comServer, comAddr, comDir, 'Community Conn Admin');
      const headers = {
        'Authorization': `Bearer ${claim.token}`,
        'Content-Type': 'application/json',
      };

      // Trigger default connection creation
      await fetch(`${comAddr}/api/v1/whatsapp/status`, { headers });

      // Attempt second connection in Community -> MUST FAIL WITH 403
      const secondConnRes = await fetch(`${comAddr}/api/v1/connections`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Tentativa Segundo Chip' }),
      });
      assert.equal(secondConnRes.status, 403, 'Community edition must reject multiple connections with 403');
      const errData = await secondConnRes.json();
      assert.equal(errData.error, 'CommunityEditionConnectionLimitError');
    } finally {
      await comServer.stop();
      cleanDir(comDir);
    }
  });

  it('[Criterion 4: Inviolable Safety Floor Enforced in Enterprise (ADR 0060)]', async () => {
    const entDir = makeTempDir('ent-safety-');
    const entServer = createServer({ dataDir: entDir, port: 0, edition: 'enterprise' });
    const { address: entAddr } = await entServer.start();

    try {
      const claim = await claimServer(entServer, entAddr, entDir, 'Safety Test Admin');
      const headers = {
        'Authorization': `Bearer ${claim.token}`,
        'Content-Type': 'application/json',
      };

      // Attempt campaign with pacing < 15 seconds (Safety Floor violation, ADR 0060)
      const pacingViolRes = await fetch(`${entAddr}/api/v1/campaigns`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Violating Campaign',
          pacingIntervalSeconds: 5, // Below SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS (15s)
          dailyLimit: 200,
          confirmedResponsibility: true,
        }),
      });

      assert.equal(pacingViolRes.status, 400, 'Safety floor pacing constraint must remain active in Enterprise');
      const err = await pacingViolRes.json();
      assert.equal(err.error, 'SafetyFloorViolation');
    } finally {
      await entServer.stop();
      cleanDir(entDir);
    }
  });

  it('[Criterion 5: Enterprise Cloud Backup Provider & License Manager Integration]', async () => {
    const licenseMgr = new EnterpriseLicenseManager('super-enterprise-test-salt');
    const token = licenseMgr.generateLicenseToken('org_enterprise_1', {
      multiConnection: true,
      multiFunnel: true,
      maxConnections: 100,
    });
    const validated = licenseMgr.validateLicenseToken(token);
    assert.equal(validated.valid, true);
    assert.equal(validated.edition, 'enterprise');

    const tempDir = makeTempDir('ent-cloud-backup-');
    const backupFile = path.join(tempDir, 'enterprise-recovery.enc');
    fs.writeFileSync(backupFile, 'DUMMY_ENCRYPTED_BACKUP_BLOB');

    const cloudProvider = new EnterpriseCloudBackupProvider({
      provider: 'custom',
      bucket: 'test-enterprise-backups',
      prefix: 'snapshots',
    });

    const upload = await cloudProvider.uploadBackup(backupFile, 'org_enterprise_1');
    assert.equal(upload.success, true);
    assert.ok(upload.destination.includes('snapshots/org_enterprise_1/enterprise-recovery.enc'));
    assert.ok(upload.sha256.length === 64);

    cleanDir(tempDir);
  });
});
