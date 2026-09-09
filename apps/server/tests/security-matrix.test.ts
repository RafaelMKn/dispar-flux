import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { readClaimToken } from '@dispar-flux/auth';
import { DisparFluxServer } from '../src/server.js';
import { Logger } from '../src/logger.js';

// Silent logger for clean test output
const silentLogger = new Logger({
  level: 'error',
  output: () => {},
});

describe('Security Matrix Enforcement Tests', () => {
  let tempDir: string;
  let server: DisparFluxServer;

  // Tenant A Credentials & Tokens
  let orgAId: string;
  let ownerAToken: string;
  let operatorToken: string;

  // Tenant B Credentials & Tokens
  let orgBId: string;
  let ownerBToken: string;
  let deviceBId: string;

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-sec-matrix-'));
    server = new DisparFluxServer(
      {
        port: 0,
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

    // 1. Claim Installation for Org A (Owner A)
    const claimCode = readClaimToken(tempDir);
    assert.ok(claimCode, 'Claim code must be generated upon startup');

    const claimRes = await fetch(`${server.url}/api/v1/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimCode,
        organizationName: 'Organização Alpha',
        ownerName: 'Alice Owner',
        ownerEmail: 'alice@alpha.corp',
        password: 'PasswordOwnerA123!',
        operationalTimezone: 'America/Sao_Paulo',
      }),
    });
    assert.equal(claimRes.status, 201, 'Claim should succeed with 201');
    const claimData = await claimRes.json();
    orgAId = claimData.organizationId;
    ownerAToken = claimData.token;
    assert.ok(orgAId && ownerAToken);

    // 2. Register Operator in Org A
    (server as any).memberService.createMember({
      organizationId: orgAId,
      name: 'Oscar Operator',
      email: 'oscar@alpha.corp',
      role: 'operator',
      password: 'PasswordOperatorA123!',
    });

    // Operator initial login -> needs device approval
    const opLogin1 = await fetch(`${server.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'oscar@alpha.corp',
        password: 'PasswordOperatorA123!',
        deviceFingerprint: 'operator-device-alpha-1',
        deviceName: 'Oscar Desktop',
      }),
    });
    assert.equal(opLogin1.status, 200);
    const opLogin1Data = await opLogin1.json();
    assert.equal(opLogin1Data.requiresDeviceApproval, true);
    const operatorDeviceId = opLogin1Data.deviceId;

    // Owner A approves Operator's device
    const approveOpDeviceRes = await fetch(`${server.url}/api/v1/devices/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerAToken}`,
      },
      body: JSON.stringify({ deviceId: operatorDeviceId }),
    });
    assert.equal(approveOpDeviceRes.status, 200);

    // Operator second login -> receives active session token
    const opLogin2 = await fetch(`${server.url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'oscar@alpha.corp',
        password: 'PasswordOperatorA123!',
        deviceFingerprint: 'operator-device-alpha-1',
      }),
    });
    assert.equal(opLogin2.status, 200);
    const opLogin2Data = await opLogin2.json();
    assert.equal(opLogin2Data.requiresDeviceApproval, false);
    operatorToken = opLogin2Data.token;
    assert.ok(operatorToken);

    // 3. Set up Tenant B (Org B & Owner B)
    orgBId = crypto.randomUUID();
    const now = new Date().toISOString();
    server.database!.prepare(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES (?, 'Organização Beta', 'America/Sao_Paulo', ?, ?)
    `).run(orgBId, now, now);

    const memberB = (server as any).memberService.createMember({
      organizationId: orgBId,
      name: 'Bob Owner',
      email: 'bob@beta.corp',
      role: 'owner',
      password: 'PasswordOwnerB123!',
    });

    const { device: devB } = (server as any).deviceService.registerOrGetDevice({
      memberId: memberB.id,
      deviceFingerprint: 'owner-b-primary-device',
      name: 'Bob Laptop',
    });

    (server as any).deviceService.approveDevice({
      deviceId: devB.id,
      approvedByMemberId: memberB.id,
      actorRole: 'owner',
      organizationId: orgBId,
    });

    const sessionB = (server as any).sessionService.createSession(memberB.id, devB.id);
    ownerBToken = sessionB.rawToken;
    assert.ok(ownerBToken);

    // Create a secondary unapproved device for Member B in Org B
    const { device: devB2 } = (server as any).deviceService.registerOrGetDevice({
      memberId: memberB.id,
      deviceFingerprint: 'member-b-secondary-device',
      name: 'Bob Mobile Phone',
    });
    deviceBId = devB2.id;
    assert.ok(deviceBId);
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

  describe('1. Anonymous Access (401 Unauthorized)', () => {
    const anonymousEndpoints = [
      { method: 'POST', path: '/api/v1/devices/approve', body: { deviceId: 'test-device' } },
      { method: 'GET', path: '/api/v1/contacts' },
      {
        method: 'POST',
        path: '/api/v1/campaigns',
        body: {
          name: 'Promo',
          messageTemplate: 'Hello',
          pacingIntervalSeconds: 15,
          dailyLimit: 100,
          confirmedResponsibility: true,
        },
      },
      { method: 'GET', path: '/api/v1/bases' },
      { method: 'POST', path: '/api/v1/bases', body: { name: 'New Base' } },
      { method: 'GET', path: '/api/v1/crm/leads' },
      { method: 'GET', path: '/api/v1/inbox/conversations' },
      { method: 'GET', path: '/api/v1/agenda' },
      { method: 'POST', path: '/api/v1/backup/create', body: { outputPath: 'backup.tar.gz' } },
      {
        method: 'POST',
        path: '/api/v1/backup/restore',
        body: { backupPath: 'backup.tar.gz', targetDbPath: 'target.sqlite' },
      },
      { method: 'POST', path: '/api/v1/migration/import', body: { packagePath: 'pkg.tar.gz' } },
    ];

    for (const ep of anonymousEndpoints) {
      it(`${ep.method} ${ep.path} returns 401 when no Authorization header is supplied`, async () => {
        const headers: Record<string, string> = {};
        let body: string | undefined = undefined;
        if (ep.method === 'POST') {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(ep.body || {});
        }

        const res = await fetch(`${server.url}${ep.path}`, {
          method: ep.method,
          headers,
          body,
        });

        assert.equal(res.status, 401, `Expected 401 for anonymous access to ${ep.method} ${ep.path}`);
        const data = await res.json();
        assert.equal(data.error, 'Unauthorized');
      });

      it(`${ep.method} ${ep.path} returns 401 when invalid token is supplied`, async () => {
        const headers: Record<string, string> = {
          Authorization: 'Bearer invalid_malformed_token_987654321',
        };
        let body: string | undefined = undefined;
        if (ep.method === 'POST') {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(ep.body || {});
        }

        const res = await fetch(`${server.url}${ep.path}`, {
          method: ep.method,
          headers,
          body,
        });

        assert.equal(res.status, 401, `Expected 401 for invalid token to ${ep.method} ${ep.path}`);
        const data = await res.json();
        assert.equal(data.error, 'Unauthorized');
      });
    }
  });

  describe('2. Server-side RBAC Matrix (403 vs 200/201)', () => {
    let testBaseId: string;

    before(async () => {
      // Owner creates a base in Org A so we can test DELETE with Operator
      const createBaseRes = await fetch(`${server.url}/api/v1/bases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          name: 'Base Alpha RBAC Test',
          provenance: 'Manual',
          purpose: 'RBAC Test',
        }),
      });
      assert.equal(createBaseRes.status, 201);
      const createdBase = await createBaseRes.json();
      testBaseId = createdBase.id;
      assert.ok(testBaseId);
    });

    describe('Operator restricted actions (403 Forbidden)', () => {
      it('POST /api/v1/devices/approve -> 403 Forbidden for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/devices/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${operatorToken}`,
          },
          body: JSON.stringify({ deviceId: 'any-device-id' }),
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'Forbidden');
      });

      it('POST /api/v1/campaigns -> 403 Forbidden for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/campaigns`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${operatorToken}`,
          },
          body: JSON.stringify({
            name: 'Campaign by Operator',
            messageTemplate: 'Test message',
            pacingIntervalSeconds: 15,
            dailyLimit: 100,
            confirmedResponsibility: true,
          }),
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'Forbidden');
      });

      it('POST /api/v1/bases -> 403 Forbidden for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/bases`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${operatorToken}`,
          },
          body: JSON.stringify({
            name: 'Operator Base Attempt',
          }),
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'Forbidden');
      });

      it('DELETE /api/v1/bases/:id -> 403 Forbidden for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/bases/${testBaseId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${operatorToken}`,
          },
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'Forbidden');
      });

      it('POST /api/v1/whatsapp/connect -> 403 Forbidden for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/whatsapp/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${operatorToken}`,
          },
          body: JSON.stringify({}),
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'Forbidden');
      });

      it('POST /api/v1/backup/create -> 403 Forbidden for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/backup/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${operatorToken}`,
          },
          body: JSON.stringify({ outputPath: 'attempted-backup.tar.gz' }),
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'Forbidden');
      });

      it('POST /api/v1/followups -> 403 Forbidden for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/followups`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${operatorToken}`,
          },
          body: JSON.stringify({
            name: 'Operator Followup Attempt',
            afterHours: 24,
            config: { text: 'Olá!' },
          }),
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'Forbidden');
      });
    });

    describe('Operator permitted actions (200 OK)', () => {
      it('GET /api/v1/inbox/conversations -> 200 OK for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/inbox/conversations`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${operatorToken}`,
          },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data) || Array.isArray(data.conversations));
      });

      it('GET /api/v1/crm/leads -> 200 OK for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/crm/leads`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${operatorToken}`,
          },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data.leads));
      });

      it('GET /api/v1/agenda -> 200 OK for Operator', async () => {
        const res = await fetch(`${server.url}/api/v1/agenda`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${operatorToken}`,
          },
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(Array.isArray(data));
      });
    });
  });

  describe('3. Multi-Tenant IDOR Protection (404 Not Found & Tenant Isolation)', () => {
    let baseBId: string;
    let leadBId: string;
    let appointmentBId: string;

    before(async () => {
      // 1. Create Base in Org B
      const baseBRes = await fetch(`${server.url}/api/v1/bases`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerBToken}`,
        },
        body: JSON.stringify({
          name: 'Base Confidencial Org B',
          provenance: 'Auditoria Org B',
          purpose: 'Clientes Enterprise',
        }),
      });
      assert.equal(baseBRes.status, 201);
      const baseBData = await baseBRes.json();
      baseBId = baseBData.id;
      assert.ok(baseBId);

      // 2. Create Lead in Org B
      const leadBRes = await fetch(`${server.url}/api/v1/crm/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerBToken}`,
        },
        body: JSON.stringify({
          name: 'Lead Sigiloso Org B',
          phone: '+5511977771234',
          notes: 'Dados comerciais confidenciais do cliente B',
          value: 50000,
        }),
      });
      assert.equal(leadBRes.status, 201);
      const leadBData = await leadBRes.json();
      leadBId = leadBData.id;
      assert.ok(leadBId);

      // 3. Create Appointment in Org B
      const aptBRes = await fetch(`${server.url}/api/v1/agenda`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerBToken}`,
        },
        body: JSON.stringify({
          title: 'Reunião de Diretoria Org B',
          notes: 'Negociação M&A',
          dueAt: Date.now() + 86400000,
        }),
      });
      assert.equal(aptBRes.status, 201);
      const aptBData = await aptBRes.json();
      appointmentBId = aptBData.id;
      assert.ok(appointmentBId);
    });

    it('GET /api/v1/bases/{baseB_id} with Owner A token returns 404 Not Found', async () => {
      const res = await fetch(`${server.url}/api/v1/bases/${baseBId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerAToken}`,
        },
      });
      assert.equal(res.status, 404, 'Owner A should not be able to read Org B base (IDOR)');
    });

    it('DELETE /api/v1/bases/{baseB_id} with Owner A token returns 404 Not Found', async () => {
      const res = await fetch(`${server.url}/api/v1/bases/${baseBId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${ownerAToken}`,
        },
      });
      assert.equal(res.status, 404, 'Owner A should not be able to delete Org B base (IDOR)');

      // Verify Base B was NOT deleted in Org B
      const checkB = await fetch(`${server.url}/api/v1/bases/${baseBId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerBToken}`,
        },
      });
      assert.equal(checkB.status, 200, 'Base B must remain intact in Org B');
    });

    it('GET /api/v1/crm/leads/{leadB_id} with Owner A token returns 404 Not Found', async () => {
      const res = await fetch(`${server.url}/api/v1/crm/leads/${leadBId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerAToken}`,
        },
      });
      assert.equal(res.status, 404, 'Owner A should not be able to read Org B lead (IDOR)');
    });

    it('PUT /api/v1/crm/leads/{leadB_id}/stage with Owner A token returns 404 Not Found', async () => {
      const res = await fetch(`${server.url}/api/v1/crm/leads/${leadBId}/stage`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          stageId: 'st_4',
        }),
      });
      assert.equal(res.status, 404, 'Owner A should not be able to mutate Org B lead stage (IDOR)');
    });

    it('GET /api/v1/agenda/{appointmentB_id} with Owner A token returns 404 Not Found', async () => {
      const res = await fetch(`${server.url}/api/v1/agenda/${appointmentBId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerAToken}`,
        },
      });
      assert.equal(res.status, 404, 'Owner A should not be able to read Org B appointment (IDOR)');
    });

    it('POST /api/v1/devices/approve with deviceId of Member B returns 404 Not Found for Owner A', async () => {
      const res = await fetch(`${server.url}/api/v1/devices/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          deviceId: deviceBId,
        }),
      });
      assert.equal(res.status, 404, 'Owner A must not be able to approve device from Org B');
    });

    it('Multi-tenant contact phone deduplication isolates identical phone numbers across tenants', async () => {
      const sharedPhone = '+5511999998888';

      // 1. Org A creates Contact with sharedPhone
      const createContactARes = await fetch(`${server.url}/api/v1/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerAToken}`,
        },
        body: JSON.stringify({
          phone: sharedPhone,
          name: 'Contato Alpha Corporativo',
        }),
      });
      assert.equal(createContactARes.status, 200, 'Org A contact creation should succeed');
      const resA = await createContactARes.json();
      const contactA = resA.contact || resA;

      // 2. Org B creates Contact with identical sharedPhone
      const createContactBRes = await fetch(`${server.url}/api/v1/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ownerBToken}`,
        },
        body: JSON.stringify({
          phone: sharedPhone,
          name: 'Contato Beta Corporativo',
        }),
      });
      assert.equal(createContactBRes.status, 200, 'Org B contact creation should succeed with same phone');
      const resB = await createContactBRes.json();
      const contactB = resB.contact || resB;

      // Different IDs must be generated for each tenant
      assert.ok(contactA.id && contactB.id, 'Both contacts must have valid IDs');
      assert.notEqual(contactA.id, contactB.id, 'Contacts must have distinct IDs across tenants');

      // 3. Org A queries contacts -> receives ONLY Org A contacts
      const getContactsARes = await fetch(`${server.url}/api/v1/contacts`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerAToken}`,
        },
      });
      assert.equal(getContactsARes.status, 200);
      const contactsAData = await getContactsARes.json();
      const listA: any[] = contactsAData.contacts || contactsAData.data || contactsAData;

      const foundAInA = listA.find((c) => c.phone === sharedPhone || c.normalizedPhone === sharedPhone);
      assert.ok(foundAInA, 'Org A must find its own contact');
      assert.equal(foundAInA.name, 'Contato Alpha Corporativo', "Org A must see Org A's contact name");
      assert.equal(foundAInA.id, contactA.id);

      const foundBInA = listA.find((c) => c.id === contactB.id || c.name === 'Contato Beta Corporativo');
      assert.equal(foundBInA, undefined, "Org A must NOT see Org B's contact");

      // 4. Org B queries contacts -> receives ONLY Org B contacts
      const getContactsBRes = await fetch(`${server.url}/api/v1/contacts`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${ownerBToken}`,
        },
      });
      assert.equal(getContactsBRes.status, 200);
      const contactsBData = await getContactsBRes.json();
      const listB: any[] = contactsBData.contacts || contactsBData.data || contactsBData;

      const foundBInB = listB.find((c) => c.phone === sharedPhone || c.normalizedPhone === sharedPhone);
      assert.ok(foundBInB, 'Org B must find its own contact');
      assert.equal(foundBInB.name, 'Contato Beta Corporativo', "Org B must see Org B's contact name");
      assert.equal(foundBInB.id, contactB.id);

      const foundAInB = listB.find((c) => c.id === contactA.id || c.name === 'Contato Alpha Corporativo');
      assert.equal(foundAInB, undefined, "Org B must NOT see Org A's contact");
    });
  });
});
