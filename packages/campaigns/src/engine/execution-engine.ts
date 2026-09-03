import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type Campaign,
  type CampaignJob,
  SAFETY_FLOOR,
  generateSuppressionHash,
  canRetryJob,
} from '@dispar-flux/domain';
import { CampaignService } from './campaign-service.js';
import { SerialAutomationQueue } from './serial-queue.js';
import {
  type MessagingDispatcher,
  type ExecutionEngineOptions,
  type SleepFunction,
  mapRowToCampaign,
  mapRowToJob,
  type CampaignRow,
  type CampaignJobRow,
} from './types.js';
import {
  CampaignNotFoundError,
  CampaignStateError,
} from '../errors.js';

export class CampaignExecutionEngine {
  public readonly campaignService: CampaignService;
  public readonly serialQueue: SerialAutomationQueue;
  private readonly sleepFn: SleepFunction;
  private readonly suppressionSalt?: string;
  private readonly lastSentAtByConnection = new Map<string, number>();

  constructor(
    private readonly conn: DatabaseConnection,
    private readonly dispatcher: MessagingDispatcher,
    options: ExecutionEngineOptions = {}
  ) {
    this.campaignService = new CampaignService(conn);
    this.serialQueue = new SerialAutomationQueue();
    this.sleepFn = options.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.suppressionSalt = options.suppressionSalt;
  }

  /**
   * ADR 0028: Envio Incerto Recovery.
   *
   * Any in-flight job left in 'sending' status without delivery confirmation
   * (e.g. from process crash, power loss, or unhandled interruption)
   * is marked as 'unknown'.
   *
   * Invariant: 'unknown' jobs are NEVER retried automatically!
   */
  recoverInterruptedJobs(campaignId?: string): number {
    let sql = `SELECT * FROM campaign_jobs WHERE status = 'sending'`;
    const params: string[] = [];

    if (campaignId) {
      sql += ' AND campaign_id = ?';
      params.push(campaignId);
    }

    const sendingJobs = this.conn.prepare(sql).all(...params) as unknown as CampaignJobRow[];
    if (sendingJobs.length === 0) return 0;

    const now = new Date().toISOString();
    const updateJobStmt = this.conn.prepare(`
      UPDATE campaign_jobs
      SET status = 'unknown',
          error_reason = 'Envio Incerto: process interrupted while in-flight without confirmation (ADR 0028)',
          updated_at = ?
      WHERE id = ?
    `);

    const updateCampaignStmt = this.conn.prepare(`
      UPDATE campaigns
      SET unknown_count = unknown_count + 1,
          updated_at = ?
      WHERE id = ?
    `);

    this.conn.transaction(() => {
      for (const job of sendingJobs) {
        updateJobStmt.run(now, job.id);
        updateCampaignStmt.run(now, job.campaign_id);
      }
    });

    return sendingJobs.length;
  }

  /**
   * Freezes snapshot and executes the campaign through the serial queue.
   */
  async startCampaign(campaignId: string): Promise<Campaign> {
    const { campaign } = this.campaignService.freezeSnapshot(campaignId);
    // Execute campaign asynchronously on the serial queue
    await this.processCampaign(campaign.id);
    return this.campaignService.getCampaign(campaign.id)!;
  }

  /**
   * Pauses an active campaign.
   */
  pauseCampaign(campaignId: string): Campaign {
    const campaign = this.campaignService.getCampaign(campaignId);
    if (!campaign) throw new CampaignNotFoundError(campaignId);

    if (campaign.status !== 'running') {
      throw new CampaignStateError(`Cannot pause campaign in "${campaign.status}" state. Expected "running".`);
    }

    const now = new Date().toISOString();
    this.conn
      .prepare(`
        UPDATE campaigns
        SET status = 'paused', paused_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, now, campaignId);

    return this.campaignService.getCampaign(campaignId)!;
  }

  /**
   * Resumes a paused campaign.
   * Recovers any in-flight interrupted jobs, skipping 'unknown' jobs per ADR 0028.
   */
  async resumeCampaign(campaignId: string): Promise<Campaign> {
    const campaign = this.campaignService.getCampaign(campaignId);
    if (!campaign) throw new CampaignNotFoundError(campaignId);

    if (campaign.status !== 'paused') {
      throw new CampaignStateError(`Cannot resume campaign in "${campaign.status}" state. Expected "paused".`);
    }

    // 1. Recover in-flight jobs for this campaign (marking 'sending' -> 'unknown')
    this.recoverInterruptedJobs(campaignId);

    // 2. Set campaign status back to 'running'
    const now = new Date().toISOString();
    this.conn
      .prepare(`
        UPDATE campaigns
        SET status = 'running', updated_at = ?
        WHERE id = ?
      `)
      .run(now, campaignId);

    // 3. Continue processing pending jobs
    await this.processCampaign(campaignId);
    return this.campaignService.getCampaign(campaignId)!;
  }

  /**
   * Cancels a campaign.
   */
  cancelCampaign(campaignId: string): Campaign {
    const campaign = this.campaignService.getCampaign(campaignId);
    if (!campaign) throw new CampaignNotFoundError(campaignId);

    if (campaign.status === 'completed' || campaign.status === 'canceled') {
      throw new CampaignStateError(`Cannot cancel campaign in "${campaign.status}" state.`);
    }

    const now = new Date().toISOString();
    this.conn
      .prepare(`
        UPDATE campaigns
        SET status = 'canceled', canceled_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(now, now, campaignId);

    return this.campaignService.getCampaign(campaignId)!;
  }

  /**
   * Main dispatch loop for a campaign.
   * Runs under the Serial Automation Queue for the campaign's connection (ADR 0027).
   */
  async processCampaign(campaignId: string): Promise<void> {
    const campaign = this.campaignService.getCampaign(campaignId);
    if (!campaign) throw new CampaignNotFoundError(campaignId);

    // Strict serialization: 1 automated job processed at a time per messaging connection (ADR 0027)
    await this.serialQueue.runExclusive(campaign.connectionId, async () => {
      // Recover interrupted jobs before picking up queue
      this.recoverInterruptedJobs(campaignId);

      while (true) {
        // 1. Re-read fresh campaign status
        const currentCampaign = this.campaignService.getCampaign(campaignId);
        if (!currentCampaign || currentCampaign.status !== 'running') {
          break;
        }

        // 2. Check 24-hour Daily Quota Ceiling (ADR 0060)
        const dailyLimit = currentCampaign.dailyLimit;
        const sentLast24h = this.countSentToday(currentCampaign.connectionId);

        if (sentLast24h >= dailyLimit) {
          // Safety ceiling reached! Pause campaign
          const now = new Date().toISOString();
          this.conn
            .prepare(`
              UPDATE campaigns
              SET status = 'paused', paused_at = ?, updated_at = ?
              WHERE id = ?
            `)
            .run(now, now, campaignId);
          break;
        }

        // 3. Fetch next pending job in strict FIFO order
        // Invariant: ONLY 'pending' jobs are selected. 'unknown' jobs are NEVER retried (ADR 0028)!
        const nextJobRow = this.conn
          .prepare(`
            SELECT * FROM campaign_jobs
            WHERE campaign_id = ? AND status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
          `)
          .get(campaignId) as unknown as CampaignJobRow | undefined;

        if (!nextJobRow) {
          // No more pending jobs. Check if any are still in flight or if campaign is completed.
          const remainingRow = this.conn
            .prepare(`
              SELECT COUNT(*) as count FROM campaign_jobs
              WHERE campaign_id = ? AND status = 'sending'
            `)
            .get(campaignId) as { count: number };

          if (remainingRow.count === 0) {
            const now = new Date().toISOString();
            this.conn
              .prepare(`
                UPDATE campaigns
                SET status = 'completed', completed_at = ?, updated_at = ?
                WHERE id = ?
              `)
              .run(now, now, campaignId);
          }
          break;
        }

        const job = mapRowToJob(nextJobRow);

        // 4. Enforce Pacing Interval (ADR 0060)
        // Minimum allowable pacing interval is 15 seconds
        const pacingSeconds = Math.max(
          SAFETY_FLOOR.MIN_PACING_INTERVAL_SECONDS,
          currentCampaign.pacingIntervalSeconds
        );
        const pacingMs = pacingSeconds * 1000;

        const lastSentTime = this.lastSentAtByConnection.get(currentCampaign.connectionId);
        if (lastSentTime !== undefined) {
          const elapsed = Date.now() - lastSentTime;
          if (elapsed < pacingMs) {
            await this.sleepFn(pacingMs - elapsed);
          }
        }

        // Re-read status in case campaign was paused/canceled during pacing sleep
        const postPacingCampaign = this.campaignService.getCampaign(campaignId);
        if (!postPacingCampaign || postPacingCampaign.status !== 'running') {
          break;
        }

        // 5. Moment-of-Send Opt-Out & Suppression Key Validation (ADR 0035, ADR 0040, ADR 0044)
        const isEligible = this.validateSendEligibility(
          currentCampaign.organizationId,
          job.normalizedPhone
        );

        if (!isEligible.eligible) {
          // Block dispatch: mark job failed with opt-out / suppression reason
          const now = new Date().toISOString();
          this.conn
            .prepare(`
              UPDATE campaign_jobs
              SET status = 'failed', error_reason = ?, updated_at = ?
              WHERE id = ?
            `)
            .run(isEligible.reason ?? 'Blocked by opt-out/suppression policy', now, job.id);

          this.conn
            .prepare(`
              UPDATE campaigns
              SET failed_count = failed_count + 1, updated_at = ?
              WHERE id = ?
            `)
            .run(now, campaignId);

          continue;
        }

        // 6. Transition job to 'sending' before dispatching (ADR 0028)
        const sendingAt = new Date().toISOString();
        this.conn
          .prepare(`
            UPDATE campaign_jobs
            SET status = 'sending', updated_at = ?
            WHERE id = ?
          `)
          .run(sendingAt, job.id);

        // 7. Dispatch via Messaging Connector
        let sendResult;
        try {
          sendResult = await this.dispatcher.sendMessage({
            connectionId: currentCampaign.connectionId,
            to: job.normalizedPhone,
            content: job.renderedMessage,
            campaignJobId: job.id,
          });
        } catch (err) {
          // If error was thrown, consider whether it's a known dispatch failure
          sendResult = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        const resolvedAt = new Date().toISOString();

        if (sendResult.success) {
          // Transition to 'sent'
          this.conn
            .prepare(`
              UPDATE campaign_jobs
              SET status = 'sent', sent_at = ?, updated_at = ?
              WHERE id = ?
            `)
            .run(resolvedAt, resolvedAt, job.id);

          this.conn
            .prepare(`
              UPDATE campaigns
              SET sent_count = sent_count + 1, updated_at = ?
              WHERE id = ?
            `)
            .run(resolvedAt, campaignId);

          this.lastSentAtByConnection.set(currentCampaign.connectionId, Date.now());
        } else {
          // Transition to 'failed' with known error
          this.conn
            .prepare(`
              UPDATE campaign_jobs
              SET status = 'failed', error_reason = ?, updated_at = ?
              WHERE id = ?
            `)
            .run(sendResult.error ?? 'Message rejected by connector', resolvedAt, job.id);

          this.conn
            .prepare(`
              UPDATE campaigns
              SET failed_count = failed_count + 1, updated_at = ?
              WHERE id = ?
            `)
            .run(resolvedAt, campaignId);

          this.lastSentAtByConnection.set(currentCampaign.connectionId, Date.now());
        }
      }
    });
  }

  /**
   * Re-validates opt-out and suppression status at the exact moment of send (ADR 0035, 0040, 0044).
   */
  private validateSendEligibility(
    organizationId: string,
    normalizedPhone: string
  ): { eligible: boolean; reason?: string } {
    // 1. Organization-wide active opt-out (ADR 0040)
    const optOut = this.conn
      .prepare(`
        SELECT id, created_at FROM opt_outs
        WHERE organization_id = ? AND normalized_phone = ? AND reauthorized_at IS NULL
      `)
      .get(organizationId, normalizedPhone) as { id: string; created_at: string } | undefined;

    if (optOut) {
      return {
        eligible: false,
        reason: `Blocked by active organization-wide opt-out registered on ${optOut.created_at}`,
      };
    }

    // 2. Pseudonymous suppression key (ADR 0044)
    if (this.suppressionSalt) {
      const hash = generateSuppressionHash(normalizedPhone, this.suppressionSalt);
      const suppressed = this.conn
        .prepare(`
          SELECT id FROM suppression_keys
          WHERE organization_id = ? AND hash_key = ?
        `)
        .get(organizationId, hash);

      if (suppressed) {
        return {
          eligible: false,
          reason: 'Blocked by pseudonymous suppression key from previously deleted contact (ADR 0044)',
        };
      }
    }

    return { eligible: true };
  }

  /**
   * Counts automated messages sent by a connection in the last 24 hours.
   */
  private countSentToday(connectionId: string): number {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const row = this.conn
      .prepare(`
        SELECT COUNT(*) as count
        FROM campaign_jobs j
        JOIN campaigns c ON j.campaign_id = c.id
        WHERE c.connection_id = ? AND j.status = 'sent' AND j.sent_at >= ?
      `)
      .get(connectionId, oneDayAgo) as { count: number };

    return row.count;
  }
}
