import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, runMigrations } from '@dispar-flux/database';
import {
  SqliteCrmRepository,
  LeadNotFoundError,
  type CrmFunnel,
  type CrmLead,
  type Appointment,
} from '../src/index.js';

describe('CRM: Multi-Tenant Data Isolation & IDOR Elimination (ADR 0019, ADR 0037, ADR 0038)', () => {
  function createMultiTenantTestDb() {
    const conn = openDatabase({ filePath: ':memory:' });
    runMigrations(conn);

    const now = new Date().toISOString();
    const orgA = 'org-tenant-a';
    const orgB = 'org-tenant-b';
    const contactA = 'cnt-tenant-a';
    const contactB = 'cnt-tenant-b';

    // Seed organizations
    conn.prepare(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES (?, 'Tenant A', 'America/Sao_Paulo', ?, ?),
             (?, 'Tenant B', 'America/Sao_Paulo', ?, ?)
    `).run(orgA, now, now, orgB, now, now);

    // Seed contacts
    conn.prepare(`
      INSERT INTO contacts (id, organization_id, normalized_phone, name, created_at, updated_at)
      VALUES (?, ?, '+5511999991111', 'Contato A', ?, ?),
             (?, ?, '+5511999992222', 'Contato B', ?, ?)
    `).run(contactA, orgA, now, now, contactB, orgB, now, now);

    const repo = new SqliteCrmRepository(conn);
    return { conn, repo, orgA, orgB, contactA, contactB };
  }

  it('getLead: Tenant B cannot retrieve Tenant A lead when scoped to orgB', () => {
    const { conn, repo, orgA, orgB, contactA } = createMultiTenantTestDb();
    try {
      const now = new Date();
      const funnelA: CrmFunnel = {
        id: 'fnl-a',
        organizationId: orgA,
        name: 'Funil A',
        stages: [{ id: 'stg-1', name: 'novo', order: 0 }],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      repo.insertFunnel(funnelA);

      const leadA: CrmLead = {
        id: 'lead-a-1',
        organizationId: orgA,
        funnelId: 'fnl-a',
        contactId: contactA,
        stageId: 'stg-1',
        value: 1500,
        notes: 'Lead confidencial A',
        createdAt: now,
        updatedAt: now,
      };
      repo.insertLead(leadA);

      // Scoped to orgA -> returns lead
      const foundA = repo.getLead(leadA.id, orgA);
      assert.ok(foundA);
      assert.equal(foundA.id, leadA.id);
      assert.equal(foundA.value, 1500);

      // Scoped to orgB -> returns undefined (IDOR prevented!)
      const foundB = repo.getLead(leadA.id, orgB);
      assert.equal(foundB, undefined);
    } finally {
      conn.close();
    }
  });

  it('updateLeadStage: Tenant B cannot update Tenant A lead stage when scoped to orgB', () => {
    const { conn, repo, orgA, orgB, contactA } = createMultiTenantTestDb();
    try {
      const now = new Date();
      const funnelA: CrmFunnel = {
        id: 'fnl-a',
        organizationId: orgA,
        name: 'Funil A',
        stages: [
          { id: 'stg-1', name: 'novo', order: 0 },
          { id: 'stg-2', name: 'ganho', order: 1 },
        ],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      repo.insertFunnel(funnelA);

      const leadA: CrmLead = {
        id: 'lead-a-1',
        organizationId: orgA,
        funnelId: 'fnl-a',
        contactId: contactA,
        stageId: 'stg-1',
        createdAt: now,
        updatedAt: now,
      };
      repo.insertLead(leadA);

      // Tenant B attempts to move Tenant A's lead stage
      assert.throws(
        () => repo.updateLeadStage(leadA.id, 'stg-2', orgB),
        (err: unknown) => err instanceof LeadNotFoundError
      );

      // Verify stage remained 'stg-1'
      const leadCheck = repo.getLead(leadA.id, orgA);
      assert.equal(leadCheck?.stageId, 'stg-1');

      // Tenant A can update its own lead stage
      repo.updateLeadStage(leadA.id, 'stg-2', orgA);
      const leadUpdated = repo.getLead(leadA.id, orgA);
      assert.equal(leadUpdated?.stageId, 'stg-2');
    } finally {
      conn.close();
    }
  });

  it('getAppointment: Tenant B cannot view Tenant A appointment when scoped to orgB', () => {
    const { conn, repo, orgA, orgB, contactA } = createMultiTenantTestDb();
    try {
      const now = new Date();
      const start = new Date(now.getTime() + 3600000);
      const end = new Date(start.getTime() + 1800000);

      const aptA: Appointment = {
        id: 'apt-a-1',
        organizationId: orgA,
        contactId: contactA,
        title: 'Reunião Comercial Confidencial',
        description: 'Dados estratégicos do Tenant A',
        scheduledStartTime: start,
        scheduledEndTime: end,
        status: 'scheduled',
        timezone: 'America/Sao_Paulo',
        createdAt: now,
        updatedAt: now,
      };
      repo.insertAppointment(aptA);

      // Scoped to orgA -> returns appointment
      const foundA = repo.getAppointment(aptA.id, orgA);
      assert.ok(foundA);
      assert.equal(foundA.id, aptA.id);

      // Scoped to orgB -> returns undefined (IDOR prevented!)
      const foundB = repo.getAppointment(aptA.id, orgB);
      assert.equal(foundB, undefined);
    } finally {
      conn.close();
    }
  });

  it('getFunnel & getLeadByContactAndFunnel: cross-tenant queries return undefined', () => {
    const { conn, repo, orgA, orgB, contactA } = createMultiTenantTestDb();
    try {
      const now = new Date();
      const funnelA: CrmFunnel = {
        id: 'fnl-a',
        organizationId: orgA,
        name: 'Funil Estratégico A',
        stages: [{ id: 'stg-1', name: 'novo', order: 0 }],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      repo.insertFunnel(funnelA);

      const leadA: CrmLead = {
        id: 'lead-a-1',
        organizationId: orgA,
        funnelId: 'fnl-a',
        contactId: contactA,
        stageId: 'stg-1',
        createdAt: now,
        updatedAt: now,
      };
      repo.insertLead(leadA);

      // getFunnel
      assert.ok(repo.getFunnel('fnl-a', orgA));
      assert.equal(repo.getFunnel('fnl-a', orgB), undefined);

      // getLeadByContactAndFunnel
      assert.ok(repo.getLeadByContactAndFunnel(contactA, 'fnl-a', orgA));
      assert.equal(repo.getLeadByContactAndFunnel(contactA, 'fnl-a', orgB), undefined);
    } finally {
      conn.close();
    }
  });
});
