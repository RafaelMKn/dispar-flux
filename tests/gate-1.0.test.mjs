import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { createServer } from '../apps/server/dist/server.js';
import { readClaimToken } from '../packages/auth/dist/onboarding/claim-token.js';
import { createMigrationPackage } from '../packages/migration/dist/exporter.js';
import { sha256 } from '../packages/migration/dist/crypto.js';
import { canRetryJob } from '../packages/domain/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function makeTempDir(prefix = 'dispar-gate-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // best effort
  }
}

describe('Dispar Flux Web 1.0 Gate Test Suite (Master Plan Section 17)', { concurrency: 1 }, () => {
  // Common test state across criteria
  let mainTempDir;
  let mainServer;
  let mainAddress;
  let mainPort;
  let ownerToken;
  let orgId;
  let ownerMemberId;

  const RECOVERY_KEY = 'flux_rec_test_key_0123456789abcdef0123456789abcdef';

  before(async () => {
    mainTempDir = makeTempDir('dispar-gate-main-');
    mainServer = createServer({
      dataDir: mainTempDir,
      port: 0,
      recoveryKey: RECOVERY_KEY,
    });
    const { address, port } = await mainServer.start();
    mainAddress = address;
    mainPort = port;
  });

  after(async () => {
    if (mainServer && mainServer.isRunning) {
      await mainServer.stop();
    }
    cleanDir(mainTempDir);
  });

  // Criterion 1: Complete server lifecycle
  it('[Criterion 1] Complete server lifecycle: boots, passes /health and /ready, graceful shutdown', async () => {
    const tempDir = makeTempDir('gate-c1-');
    const server = createServer({
      dataDir: tempDir,
      port: 0,
    });

    const { port, address } = await server.start();
    assert.ok(port > 0, 'Server should bind to ephemeral port');
    assert.equal(server.isRunning, true, 'Server isRunning should be true');

    // Test /health
    const healthRes = await fetch(`${address}/health`);
    assert.equal(healthRes.status, 200, 'Expected HTTP 200 from /health');
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.version, '0.0.1');
    assert.ok(typeof healthBody.uptimeSeconds === 'number');

    // Test /ready
    const readyRes = await fetch(`${address}/ready`);
    assert.equal(readyRes.status, 200, 'Expected HTTP 200 from /ready');
    const readyBody = await readyRes.json();
    assert.equal(readyBody.status, 'ready');
    assert.equal(readyBody.database, 'connected');
    assert.equal(readyBody.checks.database, true);
    assert.equal(readyBody.checks.installationLock, true);

    // Graceful shutdown
    await server.stop();
    assert.equal(server.isRunning, false, 'Server isRunning should be false after stop');

    // Connection after stop should fail
    await assert.rejects(
      async () => await fetch(`${address}/health`),
      (err) => err.code === 'ECONNREFUSED' || err.message.includes('fetch failed')
    );

    cleanDir(tempDir);
  });

  // Criterion 2: Persistence across restart on real SQLite with WAL
  it('[Criterion 2] Persistence across restart on real SQLite with WAL', async () => {
    const tempDir = makeTempDir('gate-c2-');

    // First boot
    const server1 = createServer({ dataDir: tempDir, port: 0 });
    const { address: addr1 } = await server1.start();

    // Verify WAL mode PRAGMA
    const journalMode = server1.database.getPragma('journal_mode');
    assert.equal(journalMode, 'wal', 'SQLite must operate in WAL journal mode');

    // Insert persistent record
    const testOrgId = 'org-persist-test-1';
    server1.database.prepare(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES (?, ?, 'America/Sao_Paulo', datetime('now'), datetime('now'))
    `).run(testOrgId, 'Persistent Corp');

    await server1.stop();

    // Second boot using identical data directory
    const server2 = createServer({ dataDir: tempDir, port: 0 });
    await server2.start();

    // Verify data survived restart
    const row = server2.database
      .prepare('SELECT id, name FROM organizations WHERE id = ?')
      .get(testOrgId);

    assert.ok(row, 'Data must persist across server restarts');
    assert.equal(row.id, testOrgId);
    assert.equal(row.name, 'Persistent Corp');

    await server2.stop();
    cleanDir(tempDir);
  });

  // Criterion 3: Strict second runtime rejection via Installation Lock
  it('[Criterion 3] Strict second runtime rejection via Installation Lock (ADR 0004 & 0010)', async () => {
    const tempDir = makeTempDir('gate-c3-');

    const primaryServer = createServer({ dataDir: tempDir, port: 0 });
    await primaryServer.start();

    // Second instance attempting to start on the exact same dataDir must be strictly rejected
    const secondaryServer = createServer({ dataDir: tempDir, port: 0 });
    await assert.rejects(
      async () => {
        await secondaryServer.start();
      },
      (err) => {
        return (
          err.name === 'InstallationLockedError' ||
          err.message.includes('already active')
        );
      },
      'Second server runtime must be rejected when installation lock is held'
    );

    // After primary shuts down, lock is released and secondary should succeed
    await primaryServer.stop();

    const resumedServer = createServer({ dataDir: tempDir, port: 0 });
    await resumedServer.start();
    assert.equal(resumedServer.isRunning, true, 'Server should acquire lock after first instance stops');
    await resumedServer.stop();

    cleanDir(tempDir);
  });

  // Criterion 4: Onboarding claim flow: claim code -> creates Owner -> invalidates claim code
  it('[Criterion 4] Onboarding claim flow: claim code -> creates Owner -> invalidates claim code', async () => {
    const claimCode = readClaimToken(mainTempDir);
    assert.ok(claimCode, 'Claim code token file must exist on fresh boot');
    assert.match(claimCode, /^FLUX-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/, 'Claim code format must be FLUX-XXXX-XXXX-XXXX');

    // Attempt claim with invalid code
    const badRes = await fetch(`${mainAddress}/api/v1/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimCode: 'FLUX-0000-0000-0000',
        organizationName: 'Dispar Flux Production Inc',
        ownerName: 'Rafael Admin',
        ownerEmail: 'rafael@disparflux.local',
        password: 'SuperSecretPassword123!',
        operationalTimezone: 'America/Sao_Paulo',
      }),
    });
    assert.equal(badRes.status, 400, 'Invalid claim code must be rejected with 400 Bad Request');

    // Perform valid claim
    const claimRes = await fetch(`${mainAddress}/api/v1/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimCode,
        organizationName: 'Dispar Flux Production Inc',
        ownerName: 'Rafael Admin',
        ownerEmail: 'rafael@disparflux.local',
        password: 'SuperSecretPassword123!',
        operationalTimezone: 'America/Sao_Paulo',
      }),
    });
    assert.equal(claimRes.status, 201, 'Valid claim must return 201 Created');
    const claimData = await claimRes.json();
    assert.ok(claimData.organizationId, 'Must return organizationId');
    assert.ok(claimData.ownerId, 'Must return ownerId');
    assert.ok(claimData.token, 'Must return initial session token');
    assert.ok(claimData.recoveryKeyGuidance, 'Must return recovery key guidance');

    orgId = claimData.organizationId;
    ownerMemberId = claimData.ownerId;
    ownerToken = claimData.token;

    // Verify claim.token file is destroyed immediately
    const claimTokenAfter = readClaimToken(mainTempDir);
    assert.equal(claimTokenAfter, null, 'Claim token file must be destroyed after successful claim');

    // Attempt second claim -> MUST return 409 Conflict
    const secondClaimRes = await fetch(`${mainAddress}/api/v1/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimCode,
        organizationName: 'Hacker Org',
        ownerName: 'Eve Hacker',
        ownerEmail: 'eve@evil.com',
        password: 'Password123!',
        operationalTimezone: 'America/Sao_Paulo',
      }),
    });
    assert.equal(secondClaimRes.status, 409, 'Second claim attempt must be rejected with 409 Conflict');
  });

  // Criterion 5: Session lifecycle: login, idle timeout, absolute expiration, logout
  it('[Criterion 5] Session lifecycle: login, idle timeout, absolute expiration, logout (ADR 0047)', async () => {
    // 1. Login with valid credentials
    const loginRes = await fetch(`${mainAddress}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rafael@disparflux.local',
        password: 'SuperSecretPassword123!',
        deviceFingerprint: 'owner-primary-browser',
      }),
    });
    assert.equal(loginRes.status, 200, 'Login should succeed with HTTP 200');
    const loginData = await loginRes.json();
    assert.ok(loginData.token, 'Login must issue session token');
    assert.equal(loginData.member.email, 'rafael@disparflux.local');
    assert.equal(loginData.requiresDeviceApproval, false);

    const testToken = loginData.token;

    // 2. Validate active session
    const sessionRes = await fetch(`${mainAddress}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    assert.equal(sessionRes.status, 200, 'Active session should validate');

    // 3. Test Idle Timeout (12 hours of inactivity per ADR 0047)
    const tokenHash = sha256(testToken);
    const pastIdle = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    mainServer.database.prepare(`
      UPDATE sessions
      SET idle_expires_at = ?
      WHERE token_hash = ?
    `).run(pastIdle, tokenHash);

    const idleExpiredRes = await fetch(`${mainAddress}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${testToken}` },
    });
    assert.equal(idleExpiredRes.status, 401, 'Idle expired session must return 401 Unauthorized');

    // 4. Test Absolute Expiration (30 days lifespan per ADR 0047)
    // Log in again for fresh session
    const freshLogin = await fetch(`${mainAddress}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rafael@disparflux.local',
        password: 'SuperSecretPassword123!',
        deviceFingerprint: 'owner-primary-browser',
      }),
    });
    const freshToken = (await freshLogin.json()).token;
    const freshTokenHash = sha256(freshToken);

    const pastExpiry = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    mainServer.database.prepare(`
      UPDATE sessions
      SET expires_at = ?
      WHERE token_hash = ?
    `).run(pastExpiry, freshTokenHash);

    const absExpiredRes = await fetch(`${mainAddress}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    assert.equal(absExpiredRes.status, 401, 'Absolute expired session must return 401 Unauthorized');

    // 5. Logout flow
    const logoutLogin = await fetch(`${mainAddress}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rafael@disparflux.local',
        password: 'SuperSecretPassword123!',
        deviceFingerprint: 'owner-primary-browser',
      }),
    });
    const logoutToken = (await logoutLogin.json()).token;

    const logoutRes = await fetch(`${mainAddress}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${logoutToken}` },
    });
    assert.equal(logoutRes.status, 200, 'Logout should succeed');

    const postLogoutRes = await fetch(`${mainAddress}/api/v1/auth/session`, {
      headers: { Authorization: `Bearer ${logoutToken}` },
    });
    assert.equal(postLogoutRes.status, 401, 'Revoked session after logout must be rejected');
  });

  // Criterion 6: Device trust lifecycle: 90-day inactivity expiration, Owner approval
  it('[Criterion 6] Device trust lifecycle: 90-day inactivity expiration, Owner approval (ADR 0011, 0047)', async () => {
    mainServer.rateLimiter.reset();
    // 1. Create an operator member
    const operator = mainServer.memberService.createMember({
      organizationId: orgId,
      name: 'Joao Operator',
      email: 'joao@disparflux.local',
      password: 'OperatorPassword123!',
      role: 'operator',
    });

    // 2. Operator attempts login from an unknown, unapproved device
    const unknownDeviceRes = await fetch(`${mainAddress}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'joao@disparflux.local',
        password: 'OperatorPassword123!',
        deviceFingerprint: 'fingerprint-unapproved-laptop',
        deviceName: 'Joao Laptop Chrome',
      }),
    });

    const unknownData = await unknownDeviceRes.json();
    assert.equal(unknownData.requiresDeviceApproval, true, 'New device must require Owner approval');
    assert.ok(unknownData.deviceId, 'Should return created deviceId for approval');
    assert.equal(unknownData.token, undefined, 'No session token must be issued to unapproved device');

    // 3. Owner approves device
    const approveRes = await fetch(`${mainAddress}/api/v1/devices/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        deviceId: unknownData.deviceId,
        approve: true,
        ownerMemberId,
      }),
    });
    assert.equal(approveRes.status, 200, 'Owner approval should succeed');
    const approveData = await approveRes.json();
    assert.equal(approveData.isApproved, true);

    // 4. Now operator can login successfully
    const approvedLoginRes = await fetch(`${mainAddress}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'joao@disparflux.local',
        password: 'OperatorPassword123!',
        deviceFingerprint: 'fingerprint-unapproved-laptop',
      }),
    });
    const approvedData = await approvedLoginRes.json();
    assert.equal(approvedData.requiresDeviceApproval, false);
    assert.ok(approvedData.token, 'Should issue session token after approval');

    // 5. Test 90-day device trust inactivity expiration (ADR 0047)
    const pastDeviceExpiry = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    mainServer.database.prepare(`
      UPDATE authorized_devices
      SET expires_at = ?
      WHERE id = ?
    `).run(pastDeviceExpiry, unknownData.deviceId);

    // Attempting login from expired trusted device must require re-approval or fail
    const expiredDeviceRes = await fetch(`${mainAddress}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'joao@disparflux.local',
        password: 'OperatorPassword123!',
        deviceFingerprint: 'fingerprint-unapproved-laptop',
      }),
    });
    const expiredData = await expiredDeviceRes.json();
    assert.equal(expiredData.requiresDeviceApproval, true, 'Expired device trust must require re-approval');
  });

  // Criterion 7: Contact deduplication & Brazilian phone normalization (9th digit rule)
  it('[Criterion 7] Contact deduplication & Brazilian phone normalization (9th digit rule) (ADR 0034, 0041)', async () => {
    // 1. Post contact with full 11-digit mobile: 11 98765-4321
    const res1 = await fetch(`${mainAddress}/api/v1/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        phone: '11987654321',
        name: 'Carlos Oliveira Original',
      }),
    });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.isNew, true);
    assert.equal(data1.contact.normalizedPhone, '+5511987654321');
    const contactId = data1.contact.id;

    // 2. Post same contact using legacy 8-digit format: (11) 8765-4321 (missing 9th digit)
    // Brazilian mobile rule should insert 9 and match existing canonical contact
    const res2 = await fetch(`${mainAddress}/api/v1/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        phone: '(11) 8765-4321',
        name: 'Carlos Duplicado',
      }),
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.isNew, false, 'Must recognize as duplicate contact');
    assert.equal(data2.contact.id, contactId, 'Must resolve to existing contact ID');
    assert.equal(data2.contact.normalizedPhone, '+5511987654321');
    assert.equal(data2.contact.name, 'Carlos Oliveira Original', 'Must preserve canonical profile name (ADR 0041)');

    // 3. Post formatted with DDI: +55 (11) 98765-4321
    const res3 = await fetch(`${mainAddress}/api/v1/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        phone: '+55 (11) 98765-4321',
      }),
    });
    const data3 = await res3.json();
    assert.equal(data3.isNew, false);
    assert.equal(data3.contact.id, contactId);

    // Verify DB count in organization is strictly 1
    const countRow = mainServer.database
      .prepare('SELECT count(*) as c FROM contacts WHERE organization_id = ? AND normalized_phone = ?')
      .get(orgId, '+5511987654321');
    assert.equal(Number(countRow.c), 1, 'Exactly one canonical contact must exist');
  });

  // Criterion 8: Safety floor validation
  it('[Criterion 8] Safety floor validation: rejects pacing < 15s, rejects daily limit > 1000, enforces responsibility confirmation (ADR 0060)', async () => {
    // 1. Reject pacing interval below safety floor (< 15 seconds)
    const resPacing = await fetch(`${mainAddress}/api/v1/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Fast Campaign',
        messageTemplate: 'Hello {{name}}',
        pacingIntervalSeconds: 10, // < 15s violation!
        dailyLimit: 100,
        confirmedResponsibility: true,
      }),
    });
    assert.equal(resPacing.status, 400, 'Pacing < 15s must be rejected');
    const pacingErr = await resPacing.json();
    assert.equal(pacingErr.error, 'SafetyFloorViolation');

    // 2. Reject daily limit exceeding safety ceiling (> 1000 messages)
    const resDaily = await fetch(`${mainAddress}/api/v1/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Massive Campaign',
        messageTemplate: 'Hello {{name}}',
        pacingIntervalSeconds: 20,
        dailyLimit: 2500, // > 1000 violation!
        confirmedResponsibility: true,
      }),
    });
    assert.equal(resDaily.status, 400, 'Daily limit > 1000 must be rejected');
    const dailyErr = await resDaily.json();
    assert.equal(dailyErr.error, 'SafetyFloorViolation');

    // 3. Enforce operational responsibility confirmation
    const resResp = await fetch(`${mainAddress}/api/v1/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Unconfirmed Campaign',
        messageTemplate: 'Hello {{name}}',
        pacingIntervalSeconds: 30,
        dailyLimit: 200,
        confirmedResponsibility: false, // unconfirmed violation!
      }),
    });
    assert.equal(resResp.status, 400, 'Unconfirmed responsibility must be rejected');
    const respErr = await resResp.json();
    assert.equal(respErr.error, 'SafetyFloorViolation');

    // 4. Compliant campaign within safety floor boundaries succeeds
    const resValid = await fetch(`${mainAddress}/api/v1/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        name: 'Safe Compliant Campaign',
        messageTemplate: 'Hello {{name}}',
        pacingIntervalSeconds: 15, // exactly minimum boundary
        dailyLimit: 1000,          // exactly maximum ceiling
        confirmedResponsibility: true,
      }),
    });
    assert.equal(resValid.status, 201, 'Compliant campaign must return 201 Created');
    const campData = await resValid.json();
    assert.equal(campData.pacingIntervalSeconds, 15);
    assert.equal(campData.dailyLimit, 1000);
    assert.equal(campData.confirmedResponsibility, true);
  });

  // Criterion 9: Opt-out enforcement
  it('[Criterion 9] Opt-out enforcement: blocks automated send across entire organization, requires traceable reauthorization (ADR 0040, 0045)', async () => {
    // 1. Create a contact
    const contactRes = await fetch(`${mainAddress}/api/v1/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        phone: '11999995555',
        name: 'Ana Souza',
      }),
    });
    const contact = (await contactRes.json()).contact;

    // 2. Set Opt-out
    const optOutRes = await fetch(`${mainAddress}/api/v1/contacts/${contact.id}/opt-out`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        reason: 'Customer replied SAIR',
      }),
    });
    assert.equal(optOutRes.status, 200);

    // Verify contact marked opted out in database
    const contactInDb = mainServer.contactService.findById(contact.id);
    assert.equal(contactInDb.isOptedOut, true, 'Contact must be marked opted out');

    // Verify record in opt_outs table
    const optRow = mainServer.database
      .prepare('SELECT * FROM opt_outs WHERE normalized_phone = ?')
      .get(contact.normalizedPhone);
    assert.ok(optRow, 'Opt-out must be recorded in opt_outs');

    // 3. Attempt reauthorization without actor or justification -> REJECTED (ADR 0045)
    const badReauth = await fetch(`${mainAddress}/api/v1/contacts/${contact.id}/reauthorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(badReauth.status, 400, 'Reauthorization without justification must be rejected');

    // 4. Traceable reauthorization with authorized actor and explicit reason
    const goodReauth = await fetch(`${mainAddress}/api/v1/contacts/${contact.id}/reauthorize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        actorMemberId: ownerMemberId,
        justification: 'Customer signed renewed commercial engagement consent form in person',
      }),
    });
    assert.equal(goodReauth.status, 200, 'Traceable reauthorization should succeed');

    // Verify opt-out is cleared
    const contactAfter = mainServer.contactService.findById(contact.id);
    assert.equal(contactAfter.isOptedOut, false, 'Opt-out status should be cleared after reauthorization');
  });

  // Criterion 10: Crash recovery: in-flight job becomes 'unknown' and is NEVER retried automatically (ADR 0028)
  it('[Criterion 10] Crash recovery: in-flight job becomes "unknown" and is NEVER retried automatically (ADR 0028)', async () => {
    const tempDir = makeTempDir('gate-c10-');
    const srv1 = createServer({ dataDir: tempDir, port: 0 });
    await srv1.start();

    // Insert required parent entities to satisfy foreign key constraints
    srv1.database.exec(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES ('org_default', 'Default Org', 'America/Sao_Paulo', datetime('now'), datetime('now'));
      INSERT INTO messaging_connections (id, organization_id, name, provider, status, created_at, updated_at)
      VALUES ('conn_default', 'org_default', 'Default Conn', 'baileys', 'connected', datetime('now'), datetime('now'));
      INSERT INTO contacts (id, organization_id, normalized_phone, name, created_at, updated_at)
      VALUES ('contact_1', 'org_default', '+5511999990001', 'Test Contact', datetime('now'), datetime('now'));
    `);

    // Create a dummy campaign and jobs
    const campId = 'camp-crash-test';
    srv1.database.prepare(`
      INSERT INTO campaigns (id, organization_id, connection_id, name, status, message_template, created_at, updated_at)
      VALUES (?, 'org_default', 'conn_default', 'Crash Test Campaign', 'running', 'Test message', datetime('now'), datetime('now'))
    `).run(campId);

    const jobSentId = 'job-sent-1';
    const jobSendingId = 'job-sending-in-flight-2'; // IN-FLIGHT AT CRASH TIME
    const jobPendingId = 'job-pending-3';

    const insertJob = srv1.database.prepare(`
      INSERT INTO campaign_jobs (id, campaign_id, contact_id, normalized_phone, rendered_message, status, created_at, updated_at)
      VALUES (?, ?, 'contact_1', '+5511999990001', 'Hello', ?, datetime('now'), datetime('now'))
    `);

    insertJob.run(jobSentId, campId, 'sent');
    insertJob.run(jobSendingId, campId, 'sending'); // In-flight!
    insertJob.run(jobPendingId, campId, 'pending');

    // Simulate abrupt crash (server stops)
    await srv1.stop();

    // Re-boot server after crash
    const srv2 = createServer({ dataDir: tempDir, port: 0 });
    await srv2.start();

    // Verify: in-flight job MUST have transitioned to 'unknown'
    const jobRow = srv2.database
      .prepare('SELECT status, error_reason FROM campaign_jobs WHERE id = ?')
      .get(jobSendingId);

    assert.equal(jobRow.status, 'unknown', 'In-flight sending job must become unknown on recovery (ADR 0028)');
    assert.ok(jobRow.error_reason.includes('Envio Incerto'), 'Error reason must record Envio Incerto');

    // Verify ADR 0028 invariant: unknown jobs can NEVER be retried automatically
    const unknownJob = {
      id: jobSendingId,
      campaignId: campId,
      contactId: 'contact_1',
      normalizedPhone: '+5511999990001',
      renderedMessage: 'Hello',
      status: 'unknown',
    };
    assert.equal(canRetryJob(unknownJob), false, 'canRetryJob must return false for unknown status');

    await srv2.stop();
    cleanDir(tempDir);
  });

  // Criterion 11: Migration package parsing and reconciliation report
  it('[Criterion 11] Migration package parsing and reconciliation report (ADR 0008, 0017)', async () => {
    const exportOutDir = makeTempDir('gate-pkg-export-');
    const { packageDir } = createMigrationPackage({
      outputDir: exportOutDir,
      seedData: {
        lists: [{ id: 'list_1', name: 'Clientes 2026', created_at: 1700000000 }],
        contacts: [
          { id: 'c1', list_id: 'list_1', name: 'Ana Silva', phone_e164: '+5511988880001', opt_out: 0, extra_json: '{}', created_at: 1700000001 },
          { id: 'c2', list_id: 'list_1', name: 'Ana Silva Dup', phone_e164: '11988880001', opt_out: 0, extra_json: '{}', created_at: 1700000002 }, // Same phone!
          { id: 'c3', list_id: 'list_1', name: 'Bruno Costa', phone_e164: '+5511988880002', opt_out: 0, extra_json: '{}', created_at: 1700000003 },
        ],
        campaigns: [
          { id: 'camp_1', name: 'Campanha Black Friday', list_id: 'list_1', mode: 'manual', config_json: '{}', delay_min_ms: 1000, delay_max_ms: 2000, rest_every_n: 10, rest_duration_ms: 5000, daily_cap: 100, status: 'interrupted', created_at: 1700000010 },
        ],
        campaign_jobs: [
          { id: 'job_1', campaign_id: 'camp_1', contact_id: 'c1', rendered_text: 'Ola', status: 'sending', attempts: 1, error: null, wa_message_id: null, sent_at: null },
        ],
        opt_outs: [
          { phone_e164: '+5511977770000', reason: 'Pediu para sair', created_at: 1700000020 },
        ],
        crm_stages: [
          { id: 'stage_lead', name: 'Novo Lead', position: 0, role: 'lead', created_at: 1700000025 },
        ],
        crm_leads: [
          { id: 'lead_1', phone_e164: '+5511988880001', contact_id: 'c1', stage_id: 'stage_lead', value: 500.0, notes: 'Interessado', created_at: 1700000030, updated_at: 1700000030 },
        ],
      },
    });

    // ADR 0014: Migration requires an uninitialized/clean installation
    const migrationTempDir = makeTempDir('gate-migration-srv-');
    const migrationServer = createServer({ dataDir: migrationTempDir, port: 0 });
    const { address: migAddr } = await migrationServer.start();

    // Import package via API
    const importRes = await fetch(`${migAddr}/api/v1/migration/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        packagePath: packageDir,
      }),
    });
    const bodyText = await importRes.text();
    if (importRes.status !== 200) {
      console.error('Import failed with status:', importRes.status, bodyText);
    }
    assert.equal(importRes.status, 200, `Migration package import should succeed: ${bodyText}`);
    const importResult = JSON.parse(bodyText);

    const report = importResult.report;
    assert.equal(report.source.contacts, 3);
    assert.equal(report.target.canonicalContacts, 2, 'Must consolidate duplicate contacts into 2 unique canonical contacts');
    assert.equal(report.target.unknownJobs, 1, 'In-flight legacy sending job must be recorded as unknownJob');
    assert.equal(report.target.bases, 1);
    assert.equal(report.target.optOuts, 1);
    assert.equal(report.target.funnels, 1);
    assert.equal(report.target.leads, 1);

    await migrationServer.stop();
    cleanDir(migrationTempDir);
    cleanDir(exportOutDir);
  });

  // Criterion 12: Encrypted backup creation and restore with deletion ledger re-application
  it('[Criterion 12] Encrypted backup creation and restore with deletion ledger re-application (ADR 0020, 0031, 0046)', async () => {
    const backupServerDir = makeTempDir('gate-backup-srv-');
    const backupServer = createServer({ dataDir: backupServerDir, port: 0, recoveryKey: RECOVERY_KEY });
    const { address: bkpAddr } = await backupServer.start();

    // Populate initial contacts to be backed up
    backupServer.database.exec(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES ('org_bkp_1', 'Backup Corp', 'America/Sao_Paulo', datetime('now'), datetime('now'));
      INSERT INTO contacts (id, organization_id, normalized_phone, name, is_opted_out, created_at, updated_at)
      VALUES ('c_bruno', 'org_bkp_1', '+5511988880002', 'Bruno Costa', 0, datetime('now'), datetime('now')),
             ('c_ana', 'org_bkp_1', '+5511988880001', 'Ana Silva', 0, datetime('now'), datetime('now'));
    `);

    const backupDir = makeTempDir('gate-backup-');
    const backupFile = path.join(backupDir, 'backup.dfbk');

    // 1. Create encrypted backup via API
    const createRes = await fetch(`${bkpAddr}/api/v1/backup/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        outputPath: backupFile,
        recoveryKey: RECOVERY_KEY,
      }),
    });
    const createText = await createRes.text();
    if (createRes.status !== 200) {
      console.error('CREATE BKP FAILED:', createRes.status, createText);
    }
    assert.equal(createRes.status, 200, `Backup creation must return 200 OK: ${createText}`);
    const createData = JSON.parse(createText);
    assert.ok(fs.existsSync(backupFile), 'Encrypted backup file must exist on disk');

    // Verify binary magic header 'DFBK'
    const backupBytes = fs.readFileSync(backupFile);
    assert.equal(backupBytes.subarray(0, 4).toString('ascii'), 'DFBK', 'Backup file must begin with DFBK header');

    // 2. Prepare Deletion Ledger records (representing deletions that happened post-backup)
    const deletionLedger = [
      {
        id: 'del_ledger_1',
        type: 'contact_deletion',
        normalizedPhone: '+5511988880002', // Bruno Costa
        timestamp: new Date().toISOString(),
        reason: 'GDPR Right to be Forgotten request',
      },
      {
        id: 'del_ledger_2',
        type: 'opt_out',
        normalizedPhone: '+5511988880001', // Ana Silva
        timestamp: new Date().toISOString(),
        reason: 'Requested opt-out via WhatsApp',
      },
    ];

    // 3. Restore backup to a new target database path with Deletion Ledger re-application (ADR 0031)
    const restoreDbFile = path.join(backupDir, 'restored-dispar.sqlite');
    const restoreRes = await fetch(`${bkpAddr}/api/v1/backup/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        backupPath: backupFile,
        targetDbPath: restoreDbFile,
        recoveryKey: RECOVERY_KEY,
        deletionLedger,
      }),
    });
    const restoreText = await restoreRes.text();
    if (restoreRes.status !== 200) {
      console.error('RESTORE BKP FAILED:', restoreRes.status, restoreText);
    }
    assert.equal(restoreRes.status, 200, `Backup restore must return 200 OK: ${restoreText}`);
    const restoreData = JSON.parse(restoreText);
    assert.ok(restoreData.restoredAt);
    assert.ok(fs.existsSync(restoreDbFile), 'Restored SQLite database must exist');

    // 4. Verify Deletion Ledger was faithfully re-applied on the restored database:
    const restoredDb = new DatabaseSync(restoreDbFile);

    // Bruno Costa (+5511988880002) was deleted in ledger -> MUST NOT be resurrected in contacts!
    const deletedContact = restoredDb
      .prepare('SELECT id FROM contacts WHERE normalized_phone = ?')
      .get('+5511988880002');
    assert.equal(deletedContact, undefined, 'Deleted contact must NOT be resurrected after restore (ADR 0031)');

    // Bruno Costa's suppression key must be recorded
    const suppressionRow = restoredDb
      .prepare('SELECT id FROM suppression_keys WHERE hash_key = ?')
      .get(sha256('dispar_flux_suppression:+5511988880002'));
    assert.ok(suppressionRow, 'Suppression key must be inserted for deleted contact to prevent re-contact');

    // Ana Silva (+5511988880001) opted out in ledger -> MUST remain opted out in restored DB
    const optOutContact = restoredDb
      .prepare('SELECT is_opted_out FROM contacts WHERE normalized_phone = ?')
      .get('+5511988880001');
    assert.ok(optOutContact);
    assert.equal(optOutContact.is_opted_out, 1, 'Opted-out contact must remain opted-out in restored DB (ADR 0031)');

    restoredDb.close();

    // 5. Verify restore fails with wrong recovery key
    const badKeyRes = await fetch(`${bkpAddr}/api/v1/backup/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        backupPath: backupFile,
        targetDbPath: path.join(backupDir, 'should-fail.sqlite'),
        recoveryKey: 'wrong_invalid_key_12345',
      }),
    });
    assert.notEqual(badKeyRes.status, 200, 'Restore with invalid recovery key must fail');

    await backupServer.stop();
    cleanDir(backupServerDir);
    cleanDir(backupDir);
  });
});
