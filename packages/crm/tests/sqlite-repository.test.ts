import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, runMigrations } from '@dispar-flux/database';
import {
  SqliteCrmRepository,
  DuplicateLeadError,
  type CrmFunnel,
  type CrmLead,
  type Appointment,
  type FollowUpRule,
  type AutomationJob,
} from '../src/index.js';

describe('CRM: SQLite Repository Integration', () => {
  function createTestDb() {
    const conn = openDatabase({ filePath: ':memory:' });
    runMigrations(conn);

    const now = new Date().toISOString();
    const orgId = 'org-sql-1';
    const contactId = 'cnt-sql-1';

    // Seed organization
    conn.prepare(`
      INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(orgId, 'Empresa Teste CRM', 'America/Sao_Paulo', now, now);

    // Seed contact
    conn.prepare(`
      INSERT INTO contacts (id, organization_id, normalized_phone, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(contactId, orgId, '+5511999998888', 'Cliente SQLite', now, now);

    const repo = new SqliteCrmRepository(conn);
    return { conn, repo, orgId, contactId };
  }

  it('persists and retrieves Funnel and stages in SQLite', () => {
    const { conn, repo, orgId } = createTestDb();
    try {
      const now = new Date();
      const funnel: CrmFunnel = {
        id: 'fnl-sql-1',
        organizationId: orgId,
        name: 'Funil SQLite',
        stages: [
          { id: 'stg-1', name: 'novo', order: 0 },
          { id: 'stg-2', name: 'em andamento', order: 1 },
        ],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };

      repo.insertFunnel(funnel);

      const retrieved = repo.getFunnel('fnl-sql-1');
      assert.ok(retrieved);
      assert.equal(retrieved.name, 'Funil SQLite');
      assert.equal(retrieved.stages.length, 2);
      assert.equal(retrieved.stages[0]?.name, 'novo');
      assert.equal(retrieved.stages[1]?.name, 'em andamento');

      const list = repo.listFunnels(orgId);
      assert.equal(list.length, 1);
    } finally {
      conn.close();
    }
  });

  it('persists Lead and strictly enforces single Lead per Contact and Funnel in SQLite (ADR 0038)', () => {
    const { conn, repo, orgId, contactId } = createTestDb();
    try {
      const now = new Date();
      const funnel: CrmFunnel = {
        id: 'fnl-lead-sql',
        organizationId: orgId,
        name: 'Funil Leads',
        stages: [{ id: 'stg-novo', name: 'novo', order: 0 }],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      repo.insertFunnel(funnel);

      const lead1: CrmLead = {
        id: 'lead-sql-1',
        organizationId: orgId,
        funnelId: funnel.id,
        contactId,
        stageId: 'stg-novo',
        value: 1250.5,
        notes: 'Lead inicial',
        createdAt: now,
        updatedAt: now,
      };

      repo.insertLead(lead1);

      const retrieved = repo.getLead('lead-sql-1');
      assert.ok(retrieved);
      assert.equal(retrieved.value, 1250.5);
      assert.equal(retrieved.notes, 'Lead inicial');

      const byContact = repo.getLeadByContactAndFunnel(contactId, funnel.id);
      assert.ok(byContact);
      assert.equal(byContact.id, 'lead-sql-1');

      // Attempting to insert a duplicate Lead for the same (contactId, funnelId) must throw DuplicateLeadError
      const leadDuplicate: CrmLead = {
        id: 'lead-sql-2',
        organizationId: orgId,
        funnelId: funnel.id,
        contactId, // same contact!
        stageId: 'stg-novo',
        createdAt: now,
        updatedAt: now,
      };

      assert.throws(
        () => {
          repo.insertLead(leadDuplicate);
        },
        DuplicateLeadError
      );

      // Updating lead stage
      repo.updateLeadStage('lead-sql-1', 'stg-novo', new Date());
      const afterUpdate = repo.getLead('lead-sql-1');
      assert.equal(afterUpdate?.stageId, 'stg-novo');
    } finally {
      conn.close();
    }
  });

  it('persists and retrieves Appointments in SQLite', () => {
    const { conn, repo, orgId, contactId } = createTestDb();
    try {
      const start = new Date('2026-09-03T17:00:00.000Z');
      const end = new Date('2026-09-03T18:00:00.000Z');
      const now = new Date();

      const apt: Appointment = {
        id: 'apt-sql-1',
        organizationId: orgId,
        contactId,
        title: 'Reunião de Demonstração SQLite',
        description: 'Apresentação técnica',
        scheduledStartTime: start,
        scheduledEndTime: end,
        status: 'scheduled',
        reminderMinutesBefore: [15, 60],
        timezone: 'America/Sao_Paulo',
        createdAt: now,
        updatedAt: now,
      };

      repo.insertAppointment(apt);

      const retrieved = repo.getAppointment('apt-sql-1');
      assert.ok(retrieved);
      assert.equal(retrieved.title, 'Reunião de Demonstração SQLite');
      assert.equal(retrieved.scheduledStartTime.toISOString(), start.toISOString());
      assert.equal(retrieved.status, 'scheduled');
      assert.deepEqual(retrieved.reminderMinutesBefore, [15, 60]);
    } finally {
      conn.close();
    }
  });

  it('persists Follow-up Rules and Automation Jobs in SQLite', () => {
    const { conn, repo, orgId, contactId } = createTestDb();
    try {
      const now = new Date();
      const funnel: CrmFunnel = {
        id: 'fnl-fu-sql',
        organizationId: orgId,
        name: 'Funil FU',
        stages: [{ id: 'stg-fu', name: 'novo', order: 0 }],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      };
      repo.insertFunnel(funnel);

      const lead: CrmLead = {
        id: 'lead-fu-1',
        organizationId: orgId,
        funnelId: funnel.id,
        contactId,
        stageId: 'stg-fu',
        createdAt: now,
        updatedAt: now,
      };
      repo.insertLead(lead);

      const rule: FollowUpRule = {
        id: 'rule-sql-1',
        organizationId: orgId,
        funnelId: funnel.id,
        stageId: 'stg-fu',
        name: 'Follow-up SQLite',
        delayIntervalSeconds: 3600,
        messageTemplate: 'Olá {{name}}',
        isActive: true,
        maxAttempts: 2,
        createdAt: now,
        updatedAt: now,
      };
      repo.insertFollowUpRule(rule);

      const job: AutomationJob = {
        id: 'job-sql-1',
        organizationId: orgId,
        connectionId: 'conn-sql-1',
        contactId,
        leadId: lead.id,
        funnelId: funnel.id,
        stageId: 'stg-fu',
        ruleId: rule.id,
        type: 'follow_up',
        renderedMessage: 'Olá Cliente SQLite',
        status: 'pending',
        scheduledFor: now,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      repo.insertAutomationJob(job);

      // Verify row exists in sqlite
      const jobRow = conn.prepare('SELECT * FROM automation_jobs WHERE id = ?').get('job-sql-1') as Record<string, unknown>;
      assert.ok(jobRow);
      assert.equal(jobRow['rendered_message'], 'Olá Cliente SQLite');
      assert.equal(jobRow['status'], 'pending');
    } finally {
      conn.close();
    }
  });
});
