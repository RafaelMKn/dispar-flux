import { DEFAULT_OPERATIONAL_TIMEZONE } from '@dispar-flux/domain';
import { type AutomationJob } from './types.js';
import { SafetyFloorQueueError } from '../errors.js';
import { getOperationalDateString } from '../calendar/timezone.js';

export const SAFETY_FLOOR_MIN_PACING_SECONDS = 15; // ADR 0060: minimum 15s between sends
export const SAFETY_FLOOR_MAX_DAILY_LIMIT = 1000;   // ADR 0060: maximum 1000 automated sends/day

export interface SerialQueueOptions {
  connectionId: string;
  organizationId: string;
  operationalTimezone?: string;
  pacingIntervalSeconds?: number;
  dailyLimit?: number;
}

export type QueueDispatchResult =
  | { status: 'idle' }
  | { status: 'sent'; job: AutomationJob }
  | { status: 'pacing_wait'; waitRemainingSeconds: number; job: AutomationJob }
  | { status: 'daily_limit_reached'; dailySentCount: number; dailyLimit: number }
  | { status: 'canceled'; job: AutomationJob; reason: string }
  | { status: 'failed'; job: AutomationJob; reason: string }
  | { status: 'unknown'; job: AutomationJob; reason: string }; // ADR 0028: Envio Incerto

export type SendExecutor = (job: AutomationJob) => Promise<{ outcome: 'sent' | 'failed' | 'unknown'; error?: string }>;

export interface PreDispatchEvaluator {
  isContactOptedOut(contactId: string): boolean | Promise<boolean>;
  isLeadStillInStage?(leadId: string, expectedStageId: string): boolean | Promise<boolean>;
}

export class SerialAutomationQueue {
  public readonly connectionId: string;
  public readonly organizationId: string;
  public readonly operationalTimezone: string;
  public readonly pacingIntervalSeconds: number;
  public readonly dailyLimit: number;

  private queue: AutomationJob[] = [];
  private lastSentAt?: Date;
  private currentOperationalDay = '';
  private dailySentCount = 0;
  private isProcessing = false;

  constructor(options: SerialQueueOptions) {
    this.connectionId = options.connectionId;
    this.organizationId = options.organizationId;
    this.operationalTimezone = options.operationalTimezone ?? DEFAULT_OPERATIONAL_TIMEZONE;

    const pacing = options.pacingIntervalSeconds ?? SAFETY_FLOOR_MIN_PACING_SECONDS;
    if (pacing < SAFETY_FLOOR_MIN_PACING_SECONDS) {
      throw new SafetyFloorQueueError(
        `Pacing interval (${pacing}s) cannot be below Safety Floor minimum of ${SAFETY_FLOOR_MIN_PACING_SECONDS}s (ADR 0060).`
      );
    }
    this.pacingIntervalSeconds = pacing;

    const dailyLimit = options.dailyLimit ?? SAFETY_FLOOR_MAX_DAILY_LIMIT;
    if (dailyLimit <= 0 || dailyLimit > SAFETY_FLOOR_MAX_DAILY_LIMIT) {
      throw new SafetyFloorQueueError(
        `Daily limit (${dailyLimit}) must be between 1 and ${SAFETY_FLOOR_MAX_DAILY_LIMIT} (ADR 0060).`
      );
    }
    this.dailyLimit = dailyLimit;
  }

  /**
   * Enqueues a job into the connection's serial automation queue (ADR 0027).
   * Both campaigns and follow-ups share this queue.
   */
  enqueue(job: AutomationJob): void {
    this.queue.push(job);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getPendingJobs(): AutomationJob[] {
    return [...this.queue];
  }

  getLastSentAt(): Date | undefined {
    return this.lastSentAt;
  }

  getDailySentCount(): number {
    return this.dailySentCount;
  }

  /**
   * Synchronizes and resets daily sent count if the operational day has turned (ADR 0019).
   */
  private checkOperationalDay(now: Date): void {
    const today = getOperationalDateString(now, this.operationalTimezone);
    if (this.currentOperationalDay !== today) {
      this.currentOperationalDay = today;
      this.dailySentCount = 0;
    }
  }

  /**
   * Dispatches the next job in the serial queue.
   * Enforces pacing interval, daily ceiling, opt-out checks, and Envio Incerto non-repetition.
   */
  async dispatchNext(
    executor: SendExecutor,
    evaluator?: PreDispatchEvaluator,
    now = new Date()
  ): Promise<QueueDispatchResult> {
    if (this.isProcessing) {
      return { status: 'idle' };
    }

    if (this.queue.length === 0) {
      return { status: 'idle' };
    }

    this.checkOperationalDay(now);

    // 1. Daily limit ceiling check (ADR 0027 & ADR 0060)
    if (this.dailySentCount >= this.dailyLimit) {
      return {
        status: 'daily_limit_reached',
        dailySentCount: this.dailySentCount,
        dailyLimit: this.dailyLimit,
      };
    }

    // 2. Pacing interval check (ADR 0027 & ADR 0060)
    if (this.lastSentAt) {
      const elapsedSeconds = (now.getTime() - this.lastSentAt.getTime()) / 1000;
      if (elapsedSeconds < this.pacingIntervalSeconds) {
        const waitRemainingSeconds = Math.ceil(this.pacingIntervalSeconds - elapsedSeconds);
        return {
          status: 'pacing_wait',
          waitRemainingSeconds,
          job: this.queue[0]!,
        };
      }
    }

    this.isProcessing = true;
    try {
      const job = this.queue.shift()!;

      // 3. Pre-send Opt-Out check (ADR 0040 & ADR 0043)
      if (evaluator) {
        const isOptedOut = await evaluator.isContactOptedOut(job.contactId);
        if (isOptedOut) {
          job.status = 'failed';
          job.errorReason = 'Opt-out active for contact (ADR 0040)';
          job.updatedAt = now;
          return {
            status: 'failed',
            job,
            reason: job.errorReason,
          };
        }

        // 4. Pre-send Lead Stage check
        if (evaluator.isLeadStillInStage && job.leadId && job.stageId) {
          const stillInStage = await evaluator.isLeadStillInStage(job.leadId, job.stageId);
          if (!stillInStage) {
            job.status = 'canceled';
            job.errorReason = 'Lead stage changed before follow-up execution';
            job.updatedAt = now;
            return {
              status: 'canceled',
              job,
              reason: job.errorReason,
            };
          }
        }
      }

      // 5. Execute send
      job.status = 'sending';
      job.attemptCount += 1;
      job.updatedAt = now;

      let result: { outcome: 'sent' | 'failed' | 'unknown'; error?: string };
      try {
        result = await executor(job);
      } catch (err) {
        // Uncaught execution error treated as uncertain
        result = {
          outcome: 'unknown',
          error: err instanceof Error ? err.message : String(err),
        };
      }

      if (result.outcome === 'sent') {
        job.status = 'sent';
        job.sentAt = now;
        job.updatedAt = now;

        this.lastSentAt = now;
        this.dailySentCount += 1;

        return { status: 'sent', job };
      }

      if (result.outcome === 'unknown') {
        // Invariant ADR 0028: Envio Incerto must NEVER be retried automatically!
        job.status = 'unknown';
        job.errorReason = result.error ?? 'Uncertain delivery status (ADR 0028)';
        job.updatedAt = now;

        this.lastSentAt = now; // Count pacing to be safe

        return { status: 'unknown', job, reason: job.errorReason };
      }

      // Definite failure
      job.status = 'failed';
      job.errorReason = result.error ?? 'Delivery failed';
      job.updatedAt = now;

      return { status: 'failed', job, reason: job.errorReason };
    } finally {
      this.isProcessing = false;
    }
  }
}
