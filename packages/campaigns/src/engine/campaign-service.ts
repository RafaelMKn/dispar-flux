import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type Campaign,
  type CampaignJob,
  type JobStatus,
  createCampaign as createDomainCampaign,
  assertSafetyFloor,
  SAFETY_FLOOR,
  SafetyFloorViolationError,
} from '@dispar-flux/domain';
import { BaseService } from '../bases/base-service.js';
import { renderTemplate } from './template-renderer.js';
import {
  type CampaignRow,
  type CampaignJobRow,
  type CreateCampaignInput,
  mapRowToCampaign,
  mapRowToJob,
} from './types.js';
import {
  CampaignNotFoundError,
  CampaignStateError,
  BaseNotFoundError,
} from '../errors.js';

export class CampaignService {
  private readonly baseService: BaseService;

  constructor(private readonly conn: DatabaseConnection) {
    this.baseService = new BaseService(conn);
  }

  /**
   * Creates a new campaign in 'draft' status.
   * Validates Safety Floor invariants (ADR 0060).
   */
  createCampaign(input: CreateCampaignInput): Campaign {
    const pacingInterval = input.pacingIntervalSeconds ?? SAFETY_FLOOR.DEFAULT_PACING_INTERVAL_SECONDS;
    const dailyLimit = input.dailyLimit ?? SAFETY_FLOOR.DEFAULT_DAILY_LIMIT;
    const confirmedResponsibility = input.confirmedResponsibility ?? false;

    // Validate Safety Floor boundary invariants (ADR 0060)
    // Note: confirmedResponsibility is mandatory at launch, but we can validate early
    if (pacingInterval < SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS) {
      throw new SafetyFloorViolationError(
        `Pacing interval (${pacingInterval}s) violates Safety Floor: minimum is ${SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS}s`,
        'PACING_BELOW_MINIMUM'
      );
    }
    if (dailyLimit <= 0 || dailyLimit > SAFETY_FLOOR.MAX_DAILY_LIMIT_CEILING) {
      throw new SafetyFloorViolationError(
        `Daily limit (${dailyLimit}) violates Safety Floor: ceiling is ${SAFETY_FLOOR.MAX_DAILY_LIMIT_CEILING} messages/day`,
        'DAILY_LIMIT_EXCEEDED'
      );
    }

    const campaignId = crypto.randomUUID();
    const domainCampaign = createDomainCampaign({
      id: campaignId,
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      baseId: input.baseId,
      name: input.name,
      messageTemplate: input.messageTemplate,
      pacingIntervalSeconds: pacingInterval,
      dailyLimit,
      confirmedResponsibility,
    });

    const now = domainCampaign.createdAt.toISOString();

    this.conn
      .prepare(`
        INSERT INTO campaigns (
          id, organization_id, connection_id, base_id, name,
          status, message_template, pacing_interval_seconds, daily_limit,
          confirmed_responsibility, snapshot_total, sent_count, failed_count,
          unknown_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        domainCampaign.id,
        domainCampaign.organizationId,
        domainCampaign.connectionId,
        domainCampaign.baseId ?? null,
        domainCampaign.name,
        domainCampaign.status,
        domainCampaign.messageTemplate,
        domainCampaign.pacingIntervalSeconds,
        domainCampaign.dailyLimit,
        domainCampaign.confirmedResponsibility ? 1 : 0,
        0,
        0,
        0,
        0,
        now,
        now
      );

    return domainCampaign;
  }

  /**
   * Retrieves a campaign by ID.
   */
  getCampaign(id: string): Campaign | null {
    const row = this.conn
      .prepare('SELECT * FROM campaigns WHERE id = ?')
      .get(id) as unknown as CampaignRow | undefined;

    return row ? mapRowToCampaign(row) : null;
  }

  /**
   * Lists campaigns for an organization.
   */
  listCampaigns(organizationId: string): Campaign[] {
    const rows = this.conn
      .prepare('SELECT * FROM campaigns WHERE organization_id = ? ORDER BY created_at DESC')
      .all(organizationId) as unknown as CampaignRow[];

    return rows.map(mapRowToCampaign);
  }

  /**
   * Freezes the audience and rendered messages into campaign_jobs (ADR 0035).
   *
   * "Ao iniciar uma Campanha, o sistema criará um snapshot dos destinatários e do
   * conteúdo renderizado de cada job. Edições posteriores da Base, de seus campos
   * ou do template não alterarão a fila já criada..."
   */
  freezeSnapshot(campaignId: string): { campaign: Campaign; jobsCount: number } {
    const campaign = this.getCampaign(campaignId);
    if (!campaign) {
      throw new CampaignNotFoundError(campaignId);
    }

    if (campaign.status !== 'draft') {
      throw new CampaignStateError(
        `Cannot freeze snapshot for campaign with status "${campaign.status}". Expected "draft".`
      );
    }

    if (!campaign.confirmedResponsibility) {
      throw new SafetyFloorViolationError(
        'Campaign launch requires explicit confirmation of operational responsibility (ADR 0036 & ADR 0060)',
        'RESPONSIBILITY_NOT_CONFIRMED'
      );
    }

    assertSafetyFloor({
      pacingIntervalSeconds: campaign.pacingIntervalSeconds,
      dailyLimit: campaign.dailyLimit,
      confirmedResponsibility: campaign.confirmedResponsibility,
    });

    if (!campaign.baseId) {
      throw new CampaignStateError('Campaign must have an assigned Base before freezing snapshot');
    }

    const base = this.baseService.getBase(campaign.baseId);
    if (!base) {
      throw new BaseNotFoundError(campaign.baseId);
    }

    const memberships = this.baseService.listMemberships(campaign.baseId);
    const now = new Date().toISOString();

    const insertJobStmt = this.conn.prepare(`
      INSERT INTO campaign_jobs (
        id, campaign_id, contact_id, normalized_phone,
        rendered_message, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Freeze snapshot in atomic transaction
    this.conn.transaction(() => {
      for (const m of memberships) {
        const rendered = renderTemplate(campaign.messageTemplate, {
          name: m.contact.name,
          phone: m.contact.normalizedPhone,
          fields: m.importedFields,
        });

        insertJobStmt.run(
          crypto.randomUUID(),
          campaign.id,
          m.contact.id,
          m.contact.normalizedPhone,
          rendered,
          'pending',
          now,
          now
        );
      }

      this.conn
        .prepare(`
          UPDATE campaigns
          SET status = 'running', snapshot_total = ?, started_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(memberships.length, now, now, campaign.id);
    });

    const updated = this.getCampaign(campaignId)!;
    return {
      campaign: updated,
      jobsCount: memberships.length,
    };
  }

  /**
   * Retrieves a specific campaign job by ID.
   */
  getJob(jobId: string): CampaignJob | null {
    const row = this.conn
      .prepare('SELECT * FROM campaign_jobs WHERE id = ?')
      .get(jobId) as unknown as CampaignJobRow | undefined;

    return row ? mapRowToJob(row) : null;
  }

  /**
   * Lists jobs for a campaign.
   */
  listJobs(
    campaignId: string,
    options: { status?: JobStatus; limit?: number; offset?: number } = {}
  ): CampaignJob[] {
    let sql = 'SELECT * FROM campaign_jobs WHERE campaign_id = ?';
    const params: (string | number)[] = [campaignId];

    if (options.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }

    sql += ' ORDER BY created_at ASC';

    if (options.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options.offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const rows = this.conn.prepare(sql).all(...params) as unknown as CampaignJobRow[];
    return rows.map(mapRowToJob);
  }

  /**
   * Retrieves all pending jobs for a campaign.
   */
  getPendingJobs(campaignId: string): CampaignJob[] {
    const rows = this.conn
      .prepare('SELECT * FROM campaign_jobs WHERE campaign_id = ? AND status = ? ORDER BY created_at ASC')
      .all(campaignId, 'pending') as unknown as CampaignJobRow[];

    return rows.map(mapRowToJob);
  }

  /**
   * Counts jobs by status for a campaign.
   */
  countJobsByStatus(campaignId: string): Record<JobStatus, number> {
    const rows = this.conn
      .prepare('SELECT status, COUNT(*) as count FROM campaign_jobs WHERE campaign_id = ? GROUP BY status')
      .all(campaignId) as { status: string; count: number }[];

    const counts: Record<JobStatus, number> = {
      pending: 0,
      sending: 0,
      sent: 0,
      failed: 0,
      unknown: 0,
    };

    for (const r of rows) {
      if (r.status in counts) {
        counts[r.status as JobStatus] = r.count;
      }
    }

    return counts;
  }
}
