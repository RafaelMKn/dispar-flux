import type { DatabaseConnection } from '@dispar-flux/database';
import { type CrmFunnel, type FunnelStage } from '../funnel/types.js';
import { type CrmLead } from '../lead/types.js';
import { type Appointment } from '../calendar/types.js';
import { type FollowUpRule, type AutomationJob } from '../follow-up/types.js';
import { DuplicateLeadError, LeadNotFoundError } from '../errors.js';

export class SqliteCrmRepository {
  constructor(private readonly conn: DatabaseConnection) {
    this.ensureTables();
  }

  /**
   * Initializes CRM-specific extension tables in SQLite if they don't already exist.
   * Note: funnels and leads already exist in the base schema.
   */
  ensureTables(): void {
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT,
        scheduled_start_time TEXT NOT NULL,
        scheduled_end_time TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'canceled', 'no_show')),
        reminder_minutes_before TEXT NOT NULL DEFAULT '[]',
        timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_appointments_org ON appointments(organization_id);
      CREATE INDEX IF NOT EXISTS idx_appointments_contact ON appointments(contact_id);

      CREATE TABLE IF NOT EXISTS follow_up_rules (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL,
        name TEXT NOT NULL,
        delay_interval_seconds INTEGER NOT NULL,
        message_template TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        max_attempts INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_follow_up_rules_funnel ON follow_up_rules(funnel_id);

      CREATE TABLE IF NOT EXISTS automation_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        connection_id TEXT NOT NULL,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL,
        rule_id TEXT REFERENCES follow_up_rules(id) ON DELETE SET NULL,
        campaign_job_id TEXT,
        type TEXT NOT NULL CHECK (type IN ('follow_up', 'campaign')),
        rendered_message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'canceled')),
        scheduled_for TEXT NOT NULL,
        sent_at TEXT,
        error_reason TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auto_jobs_conn ON automation_jobs(connection_id);
      CREATE INDEX IF NOT EXISTS idx_auto_jobs_lead ON automation_jobs(lead_id);
    `);
  }

  // --- Funnels ---
  insertFunnel(funnel: CrmFunnel): void {
    this.conn.prepare(`
      INSERT INTO funnels (id, organization_id, name, stages, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      funnel.id,
      funnel.organizationId,
      funnel.name,
      JSON.stringify(funnel.stages),
      funnel.createdAt.toISOString(),
      funnel.updatedAt.toISOString()
    );
  }

  getFunnel(id: string): CrmFunnel | undefined {
    const row = this.conn.prepare('SELECT * FROM funnels WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row['id']),
      organizationId: String(row['organization_id']),
      name: String(row['name']),
      stages: JSON.parse(String(row['stages'] || '[]')) as FunnelStage[],
      isActive: true,
      createdAt: new Date(String(row['created_at'])),
      updatedAt: new Date(String(row['updated_at'])),
    };
  }

  listFunnels(organizationId: string): CrmFunnel[] {
    const rows = this.conn.prepare('SELECT * FROM funnels WHERE organization_id = ?').all(organizationId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row['id']),
      organizationId: String(row['organization_id']),
      name: String(row['name']),
      stages: JSON.parse(String(row['stages'] || '[]')) as FunnelStage[],
      isActive: true,
      createdAt: new Date(String(row['created_at'])),
      updatedAt: new Date(String(row['updated_at'])),
    }));
  }

  // --- Leads ---
  insertLead(lead: CrmLead): void {
    try {
      this.conn.prepare(`
        INSERT INTO leads (id, organization_id, funnel_id, contact_id, stage_id, value, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        lead.id,
        lead.organizationId,
        lead.funnelId,
        lead.contactId,
        lead.stageId,
        lead.value ?? null,
        lead.notes ?? null,
        lead.createdAt.toISOString(),
        lead.updatedAt.toISOString()
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed: leads.funnel_id, leads.contact_id')) {
        throw new DuplicateLeadError(lead.contactId, lead.funnelId);
      }
      throw err;
    }
  }

  getLead(id: string): CrmLead | undefined {
    const row = this.conn.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.mapRowToLead(row);
  }

  getLeadByContactAndFunnel(contactId: string, funnelId: string): CrmLead | undefined {
    const row = this.conn.prepare('SELECT * FROM leads WHERE contact_id = ? AND funnel_id = ?').get(contactId, funnelId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.mapRowToLead(row);
  }

  updateLeadStage(leadId: string, newStageId: string, updatedAt = new Date()): void {
    const result = this.conn.prepare(`
      UPDATE leads SET stage_id = ?, updated_at = ? WHERE id = ?
    `).run(newStageId, updatedAt.toISOString(), leadId);

    if (result.changes === 0) {
      throw new LeadNotFoundError(leadId);
    }
  }

  // --- Appointments ---
  insertAppointment(apt: Appointment): void {
    this.conn.prepare(`
      INSERT INTO appointments (
        id, organization_id, contact_id, lead_id, title, description,
        scheduled_start_time, scheduled_end_time, status, reminder_minutes_before,
        timezone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apt.id,
      apt.organizationId,
      apt.contactId,
      apt.leadId ?? null,
      apt.title,
      apt.description ?? null,
      apt.scheduledStartTime.toISOString(),
      apt.scheduledEndTime.toISOString(),
      apt.status,
      JSON.stringify(apt.reminderMinutesBefore ?? []),
      apt.timezone,
      apt.createdAt.toISOString(),
      apt.updatedAt.toISOString()
    );
  }

  getAppointment(id: string): Appointment | undefined {
    const row = this.conn.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row['id']),
      organizationId: String(row['organization_id']),
      contactId: String(row['contact_id']),
      leadId: row['lead_id'] ? String(row['lead_id']) : undefined,
      title: String(row['title']),
      description: row['description'] ? String(row['description']) : undefined,
      scheduledStartTime: new Date(String(row['scheduled_start_time'])),
      scheduledEndTime: new Date(String(row['scheduled_end_time'])),
      status: String(row['status']) as Appointment['status'],
      reminderMinutesBefore: JSON.parse(String(row['reminder_minutes_before'] || '[]')) as number[],
      timezone: String(row['timezone']),
      createdAt: new Date(String(row['created_at'])),
      updatedAt: new Date(String(row['updated_at'])),
    };
  }

  // --- Follow-up Rules ---
  insertFollowUpRule(rule: FollowUpRule): void {
    this.conn.prepare(`
      INSERT INTO follow_up_rules (
        id, organization_id, funnel_id, stage_id, name,
        delay_interval_seconds, message_template, is_active, max_attempts,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rule.id,
      rule.organizationId,
      rule.funnelId,
      rule.stageId,
      rule.name,
      rule.delayIntervalSeconds,
      rule.messageTemplate,
      rule.isActive ? 1 : 0,
      rule.maxAttempts,
      rule.createdAt.toISOString(),
      rule.updatedAt.toISOString()
    );
  }

  // --- Automation Jobs ---
  insertAutomationJob(job: AutomationJob): void {
    this.conn.prepare(`
      INSERT INTO automation_jobs (
        id, organization_id, connection_id, contact_id, lead_id, funnel_id, stage_id,
        rule_id, campaign_job_id, type, rendered_message, status,
        scheduled_for, sent_at, error_reason, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id,
      job.organizationId,
      job.connectionId,
      job.contactId,
      job.leadId,
      job.funnelId,
      job.stageId,
      job.ruleId ?? null,
      job.campaignJobId ?? null,
      job.type,
      job.renderedMessage,
      job.status,
      job.scheduledFor.toISOString(),
      job.sentAt ? job.sentAt.toISOString() : null,
      job.errorReason ?? null,
      job.attemptCount,
      job.createdAt.toISOString(),
      job.updatedAt.toISOString()
    );
  }

  private mapRowToLead(row: Record<string, unknown>): CrmLead {
    return {
      id: String(row['id']),
      organizationId: String(row['organization_id']),
      funnelId: String(row['funnel_id']),
      contactId: String(row['contact_id']),
      stageId: String(row['stage_id']),
      value: row['value'] !== null ? Number(row['value']) : undefined,
      notes: row['notes'] ? String(row['notes']) : undefined,
      createdAt: new Date(String(row['created_at'])),
      updatedAt: new Date(String(row['updated_at'])),
    };
  }
}
