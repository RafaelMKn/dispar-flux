import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { readClaimToken } from '@dispar-flux/auth';
import { DisparServer } from '../src/server.js';
import { Logger } from '../src/logger.js';

const silentLogger = new Logger({
  level: 'error',
  output: () => {},
});

/**
 * Helper to make raw HTTP requests (useful for malformed or raw path attacks).
 */
function rawHttpRequest(
  serverUrl: string,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(serverUrl);
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        method: options.method,
        path: options.path,
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('Adversarial Security Test Suite (DisparFluxServer)', () => {
  let tempDir: string;
  let server: DisparServer;
  let ownerToken: string;
  let orgAId: string;
  let ownerAId: string;
  let orgBId: string;
  let operatorToken: string;
  const legitRecoveryKey = 'my_super_secret_recovery_key_32_bytes!!';

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-adv-sec-test-'));
    server = new DisparServer(
      {
        port: 0,
        host: '127.0.0.1',
        dataDir: tempDir,
        nodeEnv: 'test',
        version: '0.0.1',
        recoveryKey: legitRecoveryKey,
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

  beforeEach(() => {
    if (server?.rateLimiter) {
      server.rateLimiter.reset();
    }
  });

  // ==========================================================================
  // Pre-Claim Attack Vectors (Unclaimed Server State)
  // ==========================================================================
  describe('4. Onboarding / Claim Spoofing (Unclaimed Phase)', () => {
    it('rejects claim code SQL injection probes with 400 Bad Request', async () => {
      const sqliProbes = [
        "' OR '1'='1",
        "' OR ''='",
        "admin'--",
        "'; DROP TABLE members;--",
        "' UNION SELECT * FROM members--",
      ];

      for (const probe of sqliProbes) {
        server.rateLimiter.reset();
        const res = await fetch(`${server.url}/api/v1/auth/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claimCode: probe,
            organizationName: 'Attacker Org',
            ownerName: 'Attacker',
            ownerEmail: 'attacker@example.com',
            password: 'StrongPassword123!',
            operationalTimezone: 'America/Sao_Paulo',
          }),
        });

        assert.equal(res.status, 400, `Expected 400 for SQLi probe: ${probe}`);
        const data = await res.json();
        assert.equal(data.error, 'Bad Request');
      }
    });

    it('rejects brute-force / random claim codes with 400 Bad Request', async () => {
      const fakeCodes = [
        '00000000-0000-0000-0000-000000000000',
        'random-hex-code-12345',
        'ABCDEF1234567890',
        'CLAIM-CODE-INCORRECT',
      ];

      for (const fakeCode of fakeCodes) {
        server.rateLimiter.reset();
        const res = await fetch(`${server.url}/api/v1/auth/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claimCode: fakeCode,
            organizationName: 'Attacker Org',
            ownerName: 'Attacker',
            ownerEmail: 'attacker@example.com',
            password: 'StrongPassword123!',
            operationalTimezone: 'America/Sao_Paulo',
          }),
        });

        assert.equal(res.status, 400, `Expected 400 for fake code: ${fakeCode}`);
      }
    });
  });

  describe('5. Backup & Recovery Key Bypass (Unclaimed Phase)', () => {
    it('POST /api/v1/backup/create without valid recoveryKey on unclaimed server returns 401', async () => {
      const res = await fetch(`${server.url}/api/v1/backup/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputPath: path.join(tempDir, 'forged-backup.bak'),
          recoveryKey: 'wrong-recovery-key-attacker',
        }),
      });

      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Unauthorized');
    });

    it('POST /api/v1/backup/restore without valid recoveryKey on unclaimed server returns 401', async () => {
      const res = await fetch(`${server.url}/api/v1/backup/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupPath: path.join(tempDir, 'fake-backup.bak'),
          targetDbPath: path.join(tempDir, 'restored.db'),
          recoveryKey: 'wrong-key',
        }),
      });

      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Unauthorized');
    });
  });

  // ==========================================================================
  // Legitimate Server Claiming to establish Org A & Owner A
  // ==========================================================================
  describe('Server Setup & Legitimate Claim', () => {
    it('legitimately claims the server with the valid claim token', async () => {
      const legitClaimCode = readClaimToken(tempDir);
      assert.ok(legitClaimCode, 'Valid claim code must exist on fresh server');

      const claimRes = await fetch(`${server.url}/api/v1/auth/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimCode: legitClaimCode,
          organizationName: 'Organização Vítima A',
          ownerName: 'Owner Legitimo',
          ownerEmail: 'owner.a@example.com',
          password: 'SuperSecurePassword2026!',
          operationalTimezone: 'America/Sao_Paulo',
        }),
      });

      assert.equal(claimRes.status, 201);
      const claimData = await claimRes.json();
      assert.ok(claimData.token);
      assert.ok(claimData.organizationId);
      assert.ok(claimData.ownerId);

      ownerToken = claimData.token;
      orgAId = claimData.organizationId;
      ownerAId = claimData.ownerId;

      // Create an operator member in Org A to test role permissions
      const opRes = server.memberService.createMember({
        organizationId: orgAId,
        name: 'Operator User',
        email: 'operator.a@example.com',
        role: 'operator',
        password: 'OperatorPassword123!',
      });
      const { device: opDevice } = server.deviceService.registerOrGetDevice({
        memberId: opRes.id,
        deviceFingerprint: 'operator-device-fp',
        name: 'Operator Laptop',
      });
      server.deviceService.approveDevice({
        deviceId: opDevice.id,
        approvedByMemberId: ownerAId,
        actorRole: 'owner',
        organizationId: orgAId,
      });
      const { rawToken: opToken } = server.sessionService.createSession(opRes.id, opDevice.id);
      operatorToken = opToken;

      // Seed a victim Org B in database directly to verify cross-tenant boundaries
      orgBId = 'org_victim_b_test';
      const now = new Date().toISOString();
      server.db!.prepare(`
        INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
        VALUES (?, 'Organização Alvo B', 'America/Recife', ?, ?)
      `).run(orgBId, now, now);

      // Create funnel for Org B
      server.db!.prepare(`
        INSERT INTO funnels (id, organization_id, name, stages, created_at, updated_at)
        VALUES ('fn_org_b', ?, 'Funil Org B', '[]', ?, ?)
      `).run(orgBId, now, now);

      // Create contact for Org B
      server.db!.prepare(`
        INSERT INTO contacts (id, organization_id, normalized_phone, name, custom_fields, is_opted_out, created_at, updated_at)
        VALUES ('ct_org_b', ?, '+5581999990000', 'Cliente Confidencial Org B', '{}', 0, ?, ?)
      `).run(orgBId, now, now);

      // Insert confidential lead in Org B
      server.db!.prepare(`
        INSERT INTO leads (id, organization_id, funnel_id, contact_id, stage_id, value, notes, created_at, updated_at)
        VALUES ('lead_org_b_secret', ?, 'fn_org_b', 'ct_org_b', 'st_secret', 50000.0, 'Confidential Org B Deal', ?, ?)
      `).run(orgBId, now, now);
    });
  });

  // ==========================================================================
  // Vector 4: Onboarding / Claim Spoofing (Claimed Phase)
  // ==========================================================================
  describe('4. Onboarding / Claim Spoofing (Claimed Phase)', () => {
    it('rejects subsequent POST /api/v1/auth/claim with 409 Conflict after server is claimed', async () => {
      const spoofAttempts = [
        'forged-claim-code-12345',
        '00000000-0000-0000-0000-000000000000',
        "' OR '1'='1",
        '',
      ];

      for (const code of spoofAttempts) {
        server.rateLimiter.reset();
        const res = await fetch(`${server.url}/api/v1/auth/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claimCode: code,
            organizationName: 'Hacker Corporation',
            ownerName: 'Evil Hacker',
            ownerEmail: 'hacker@evil.com',
            password: 'EvilPassword123!',
            operationalTimezone: 'America/Sao_Paulo',
          }),
        });

        assert.equal(res.status, 409, `Expected 409 Conflict for claim spoof attempt: ${code}`);
        const data = await res.json();
        assert.equal(data.error, 'Conflict');
        assert.match(data.message, /already been claimed/i);
      }
    });
  });

  // ==========================================================================
  // Vector 1: Session Token Forgery & Malformed Headers
  // ==========================================================================
  describe('1. Session Token Forgery & Malformed Headers', () => {
    const protectedEndpoints = [
      { path: '/api/v1/auth/session', method: 'GET' },
      { path: '/api/v1/auth/me', method: 'GET' },
      { path: '/api/v1/devices', method: 'GET' },
      { path: '/api/v1/crm/leads', method: 'GET' },
      { path: '/api/v1/crm/board', method: 'GET' },
    ];

    it('Header Authorization: Bearer forged-token-random-hex-12345 -> 401', async () => {
      for (const ep of protectedEndpoints) {
        const res = await fetch(`${server.url}${ep.path}`, {
          method: ep.method,
          headers: {
            Authorization: 'Bearer forged-token-random-hex-12345',
          },
        });
        assert.equal(res.status, 401, `Expected 401 on ${ep.path} for random hex token`);
        const data = await res.json();
        assert.equal(data.error, 'Unauthorized');
      }
    });

    it('Header Authorization: Bearer (empty) -> 401', async () => {
      for (const ep of protectedEndpoints) {
        const res = await fetch(`${server.url}${ep.path}`, {
          method: ep.method,
          headers: {
            Authorization: 'Bearer ',
          },
        });
        assert.equal(res.status, 401, `Expected 401 on ${ep.path} for empty Bearer`);
        const data = await res.json();
        assert.equal(data.error, 'Unauthorized');
      }
    });

    it('Header Authorization: Basic YWRtaW46cGFzc3dvcmQ= -> 401', async () => {
      for (const ep of protectedEndpoints) {
        const res = await fetch(`${server.url}${ep.path}`, {
          method: ep.method,
          headers: {
            Authorization: 'Basic YWRtaW46cGFzc3dvcmQ=',
          },
        });
        assert.equal(res.status, 401, `Expected 401 on ${ep.path} for Basic Auth`);
        const data = await res.json();
        assert.equal(data.error, 'Unauthorized');
      }
    });

    it('Header Authorization: Bearer \' OR \'1\'=\'1 (SQLi probe) -> 401', async () => {
      const sqliTokens = [
        "Bearer ' OR '1'='1",
        "Bearer ' OR 1=1 --",
        "Bearer ' UNION SELECT 1,2,3--",
        "Bearer '; DROP TABLE sessions;--",
      ];

      for (const sqliHeader of sqliTokens) {
        for (const ep of protectedEndpoints) {
          const res = await fetch(`${server.url}${ep.path}`, {
            method: ep.method,
            headers: {
              Authorization: sqliHeader,
            },
          });
          assert.equal(res.status, 401, `Expected 401 on ${ep.path} for SQLi token: ${sqliHeader}`);
          const data = await res.json();
          assert.equal(data.error, 'Unauthorized');
        }
      }
    });

    it('Expired session token -> 401', async () => {
      // Artificially insert an expired session in database
      const expiredRawToken = 'expired-token-' + crypto.randomBytes(16).toString('hex');
      const expiredTokenHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago
      const sessionId = crypto.randomUUID();

      // Get device ID of owner
      const deviceRow = server.db!.prepare('SELECT id FROM authorized_devices WHERE member_id = ? LIMIT 1').get(ownerAId) as { id: string };

      server.db!.prepare(`
        INSERT INTO sessions (id, member_id, device_id, token_hash, last_activity_at, idle_expires_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, ownerAId, deviceRow.id, expiredTokenHash, pastDate, pastDate, pastDate, pastDate);

      const res = await fetch(`${server.url}/api/v1/auth/session`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${expiredRawToken}`,
        },
      });

      assert.equal(res.status, 401, 'Expired session must return 401');
      const data = await res.json();
      assert.equal(data.error, 'Unauthorized');
    });

    it('Cookie df_session tampering with SQLi / malformed string -> 401', async () => {
      const maliciousCookies = [
        "df_session=' OR '1'='1",
        'df_session=forged-cookie-token-12345',
        'df_session=',
      ];

      for (const cookie of maliciousCookies) {
        const res = await fetch(`${server.url}/api/v1/crm/leads`, {
          method: 'GET',
          headers: {
            Cookie: cookie,
          },
        });
        assert.equal(res.status, 401, `Expected 401 for cookie ${cookie}`);
      }
    });
  });

  // ==========================================================================
  // Vector 2: Parameter / Context Tampering & Tenant Isolation
  // ==========================================================================
  describe('2. Parameter / Context Tampering & Tenant Isolation', () => {
    it('POST /api/v1/crm/leads with { "organizationId": "org-b", "name": "Hacker" } sets organization_id to Org A, NOT Org B', async () => {
      const res = await fetch(`${server.url}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          organizationId: orgBId,
          organization_id: orgBId,
          name: 'Hacker Lead',
          phone: '+5511999998888',
          notes: 'Attempting to inject lead into victim organization B',
        }),
      });

      assert.equal(res.status, 201, 'POST /api/v1/crm/leads should succeed');
      const created = await res.json();

      // Verify the response sets tenant ID strictly to Org A
      assert.equal(created.organizationId, orgAId, 'Lead organizationId must match caller Org A, NOT victim Org B');
      assert.equal(created.organization_id, orgAId, 'Lead organization_id must match caller Org A, NOT victim Org B');
      assert.notEqual(created.organizationId, orgBId, 'Lead must NEVER be assigned to victim Org B');

      // Verify directly in SQLite DB that the row belongs strictly to Org A
      const dbRow = server.db!.prepare('SELECT * FROM leads WHERE id = ?').get(created.id) as any;
      assert.ok(dbRow, 'Lead must exist in database');
      assert.equal(dbRow.organization_id, orgAId, 'DB row organization_id must be Org A');
      assert.notEqual(dbRow.organization_id, orgBId, 'DB row must NOT belong to Org B');
    });

    it('GET /api/v1/crm/leads?organization_id=org-b ignores query parameter and only returns Org A leads', async () => {
      const res = await fetch(`${server.url}/api/v1/crm/leads?organization_id=${orgBId}&organizationId=${orgBId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
        },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.leads));

      // Every returned lead MUST belong to Org A
      for (const lead of data.leads) {
        assert.equal(lead.organization_id, orgAId, 'All returned leads must belong to Org A');
        assert.notEqual(lead.id, 'lead_org_b_secret', 'Caller must NEVER receive Org B confidential lead');
        assert.notEqual(lead.organization_id, orgBId, 'Lead must not belong to Org B');
      }

      // Ensure confidential Org B lead was NOT leaked
      const leaked = data.leads.some((l: any) => l.id === 'lead_org_b_secret' || l.notes?.includes('Org B Deal'));
      assert.equal(leaked, false, 'Tenant isolation breached: Org B lead was exposed!');
    });

    it('POST /api/v1/contacts with { "organizationId": "org-b" } assigns contact strictly to Org A', async () => {
      const res = await fetch(`${server.url}/api/v1/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          organizationId: orgBId,
          organization_id: orgBId,
          phone: '+5511977776666',
          name: 'Contact Tamper Probe',
        }),
      });

      assert.equal(res.status, 200);
      const contactData = await res.json();
      const contact = contactData.contact || contactData;
      assert.equal(contact.organizationId, orgAId, 'Contact must belong to Org A');
      assert.notEqual(contact.organizationId, orgBId, 'Contact must NOT belong to Org B');

      const dbContact = server.db!.prepare('SELECT organization_id FROM contacts WHERE id = ?').get(contact.id) as any;
      assert.equal(dbContact.organization_id, orgAId);
    });

    it('POST /api/v1/contacts/:id/reauthorize ignores body actorMemberId and uses caller identity', async () => {
      // 1. Create and opt-out a contact in Org A
      const contactRes = await fetch(`${server.url}/api/v1/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          phone: '+5511966665555',
          name: 'Opt Out Test Contact',
        }),
      });
      const rawContact = await contactRes.json();
      const contact = rawContact.contact || rawContact;

      await fetch(`${server.url}/api/v1/contacts/${contact.id}/opt-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({ reason: 'Customer requested opt-out' }),
      });

      // 2. Reauthorize contact sending forged actorMemberId
      const forgedActorId = 'mem_forged_hacker_id_999';
      const reauthRes = await fetch(`${server.url}/api/v1/contacts/${contact.id}/reauthorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          actorMemberId: forgedActorId,
          justification: 'Audited opt-in reconfirmation from customer',
        }),
      });

      assert.equal(reauthRes.status, 200);
      const reauthData = await reauthRes.json();
      assert.equal(reauthData.reauthorized, true);

      // Verify the recorded actor is Owner A, NOT the forged ID
      const optOutRow = server.db!.prepare(`
        SELECT reauthorized_by_member_id FROM opt_outs
        WHERE contact_id = ? AND reauthorized_at IS NOT NULL
      `).get(contact.id) as any;

      assert.ok(optOutRow);
      assert.equal(optOutRow.reauthorized_by_member_id, ownerAId, 'Audited actor must be caller identity');
      assert.notEqual(optOutRow.reauthorized_by_member_id, forgedActorId, 'Server must NOT trust forged actorMemberId');
    });
  });

  // ==========================================================================
  // Vector 3: Directory Traversal / Media Protection (ADR 0012)
  // ==========================================================================
  describe('3. Directory Traversal / Media Protection (ADR 0012)', () => {
    it('GET /media/..%2f..%2fpackage.json or %2e%2e%2f -> rejected or 404 (ADR 0012)', async () => {
      const traversalPayloads = [
        '/media/..%2f..%2fpackage.json',
        '/media/%2e%2e%2f',
        '/media/....//',
        '/media/..%5c..%5cpackage.json',
        '/media/%2e%2e%2f%2e%2e%2fpackage.json',
        '/media/..%2f..%2f..%2f..%2fetc%2fpasswd',
        '/api/v1/media/..%2f..%2fpackage.json',
        '/api/v1/media/%2e%2e%2f',
      ];

      for (const payload of traversalPayloads) {
        const res = await rawHttpRequest(server.url, {
          method: 'GET',
          path: payload,
        });

        assert.equal(
          res.status,
          404,
          `Expected 404 for traversal path: ${payload}, got status ${res.status}`
        );

        // Verify it did not leak server files (e.g. package.json content)
        assert.ok(
          !res.body.includes('"name": "@dispar-flux/server"'),
          `Directory traversal leaked package.json on path: ${payload}`
        );

        // Verify it did not fall through to serve SPA index.html
        assert.ok(
          !res.body.includes('<!DOCTYPE html>') && !res.body.includes('<html'),
          `Media endpoint must NOT fall back to SPA index.html on path: ${payload}`
        );
      }
    });

    it('rejects media requests with non-existent or invalid opaque tokens with 404', async () => {
      const invalidKeys = [
        'short',
        'invalid_char$key',
        'non_existent_opaque_token_12345678',
        'test..traversal',
      ];

      for (const key of invalidKeys) {
        const res = await fetch(`${server.url}/media/${encodeURIComponent(key)}`);
        assert.equal(res.status, 404, `Expected 404 for key: ${key}`);
        const data = await res.json();
        assert.equal(data.error, 'Not Found');
      }
    });

    it('serves legitimate media file with 200 OK when opaque key exists', async () => {
      const mediaDir = path.join(tempDir, 'media');
      fs.mkdirSync(mediaDir, { recursive: true });

      const validOpaqueKey = 'opaque_test_media_key_12345678';
      const fileContent = Buffer.from('DISPAR_FLUX_MEDIA_TEST_PAYLOAD');
      fs.writeFileSync(path.join(mediaDir, validOpaqueKey), fileContent);

      const res = await fetch(`${server.url}/media/${validOpaqueKey}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/octet-stream');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

      const body = await res.text();
      assert.equal(body, 'DISPAR_FLUX_MEDIA_TEST_PAYLOAD');
    });
  });

  // ==========================================================================
  // Vector 5: Backup & Recovery Key Bypass (Claimed Phase)
  // ==========================================================================
  describe('5. Backup & Recovery Key Bypass (Claimed Phase)', () => {
    it('POST /api/v1/backup/create with body { "recoveryKey": "wrong-key" } without auth -> 401', async () => {
      const res = await fetch(`${server.url}/api/v1/backup/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputPath: path.join(tempDir, 'unauthorized-backup.bak'),
          recoveryKey: 'wrong-key',
        }),
      });

      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Unauthorized');
    });

    it('POST /api/v1/backup/restore with invalid key or without auth -> 401', async () => {
      // 1. Without auth
      const resNoAuth = await fetch(`${server.url}/api/v1/backup/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupPath: path.join(tempDir, 'nonexistent.bak'),
          targetDbPath: path.join(tempDir, 'restored.db'),
          recoveryKey: 'wrong-key',
        }),
      });
      assert.equal(resNoAuth.status, 401);

      // 2. With forged Bearer token
      const resForged = await fetch(`${server.url}/api/v1/backup/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer forged-token-random-12345',
        },
        body: JSON.stringify({
          backupPath: path.join(tempDir, 'nonexistent.bak'),
          targetDbPath: path.join(tempDir, 'restored.db'),
          recoveryKey: legitRecoveryKey,
        }),
      });
      assert.equal(resForged.status, 401);
    });

    it('POST /api/v1/backup/create with non-owner role returns 403 Forbidden', async () => {
      const res = await fetch(`${server.url}/api/v1/backup/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          outputPath: path.join(tempDir, 'operator-backup.bak'),
        }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error, 'Forbidden');
      assert.match(data.message, /only owners/i);
    });

    it('POST /api/v1/backup/restore with non-owner role returns 403 Forbidden', async () => {
      const res = await fetch(`${server.url}/api/v1/backup/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          backupPath: path.join(tempDir, 'operator-restore.bak'),
          targetDbPath: path.join(tempDir, 'restored.db'),
        }),
      });

      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error, 'Forbidden');
      assert.match(data.message, /only owners/i);
    });
  });
});
