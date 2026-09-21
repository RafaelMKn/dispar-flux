import type { DatabaseConnection } from '@dispar-flux/database';
import {
  ConnectionNotFoundError,
  MaturationFrozenError,
  MaturationLimitExceededError,
} from '../errors.js';

export type MaturationStage = 'birth' | 'activation' | 'expansion' | 'consolidation' | 'nominal';

export interface StagePolicy {
  stage: MaturationStage;
  name: string;
  dailyCap: number;
  minPacingSeconds: number;
  requiresSpintaxOrAi: boolean;
  minDay: number;
  maxDay: number;
}

export const MATURATION_STAGES: Record<MaturationStage, StagePolicy> = {
  birth: {
    stage: 'birth',
    name: 'Nascimento (Dias 1 a 3)',
    dailyCap: 0,
    minPacingSeconds: 60,
    requiresSpintaxOrAi: false,
    minDay: 1,
    maxDay: 3,
  },
  activation: {
    stage: 'activation',
    name: 'Ativação (Dias 4 a 7)',
    dailyCap: 25,
    minPacingSeconds: 45,
    requiresSpintaxOrAi: false,
    minDay: 4,
    maxDay: 7,
  },
  expansion: {
    stage: 'expansion',
    name: 'Expansão (Dias 8 a 14)',
    dailyCap: 60,
    minPacingSeconds: 30,
    requiresSpintaxOrAi: true,
    minDay: 8,
    maxDay: 14,
  },
  consolidation: {
    stage: 'consolidation',
    name: 'Consolidação (Dias 15 a 21)',
    dailyCap: 120,
    minPacingSeconds: 20,
    requiresSpintaxOrAi: false,
    minDay: 15,
    maxDay: 21,
  },
  nominal: {
    stage: 'nominal',
    name: 'Nominal (Após Dia 21)',
    dailyCap: 1000,
    minPacingSeconds: 15,
    requiresSpintaxOrAi: false,
    minDay: 22,
    maxDay: Infinity,
  },
};

export function getPolicyForDay(day: number): StagePolicy {
  const safeDay = Math.max(1, Math.floor(day));
  if (safeDay <= 3) return MATURATION_STAGES.birth;
  if (safeDay <= 7) return MATURATION_STAGES.activation;
  if (safeDay <= 14) return MATURATION_STAGES.expansion;
  if (safeDay <= 21) return MATURATION_STAGES.consolidation;
  return MATURATION_STAGES.nominal;
}

export interface MaturationState {
  connectionId: string;
  currentDay: number;
  stage: MaturationStage;
  sentToday: number;
  dailyCap: number;
  reportCount24h: number;
  isFrozen: boolean;
  minPacingSeconds: number;
  remainingToday: number;
  requiresSpintaxOrAi: boolean;
  lastEvaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface MaturationRow {
  connection_id: string;
  current_day: number;
  stage: MaturationStage;
  sent_today: number;
  daily_cap: number;
  report_count_24h: number;
  last_evaluated_at: string;
  created_at: string;
  updated_at: string;
}

export class MaturationService {
  constructor(private readonly conn: DatabaseConnection) {}

  /**
   * Retrieves or initializes the maturation state for a messaging connection.
   */
  getOrCreateState(connectionId: string): MaturationState {
    const connRow = this.conn
      .prepare('SELECT id FROM messaging_connections WHERE id = ?')
      .get(connectionId) as { id: string } | undefined;

    if (!connRow) {
      throw new ConnectionNotFoundError(connectionId);
    }

    const row = this.conn
      .prepare(`
        SELECT connection_id, current_day, stage, sent_today, daily_cap,
               report_count_24h, last_evaluated_at, created_at, updated_at
        FROM maturation_state
        WHERE connection_id = ?
      `)
      .get(connectionId) as MaturationRow | undefined;

    if (row) {
      return this.mapRow(row);
    }

    // Initialize state on Day 1
    const policy = getPolicyForDay(1);
    const now = new Date();
    const nowIso = now.toISOString();

    this.conn
      .prepare(`
        INSERT INTO maturation_state (
          connection_id, current_day, stage, sent_today, daily_cap,
          report_count_24h, last_evaluated_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        connectionId,
        1,
        policy.stage,
        0,
        policy.dailyCap,
        0,
        nowIso,
        nowIso,
        nowIso
      );

    return {
      connectionId,
      currentDay: 1,
      stage: policy.stage,
      sentToday: 0,
      dailyCap: policy.dailyCap,
      reportCount24h: 0,
      isFrozen: false,
      minPacingSeconds: policy.minPacingSeconds,
      remainingToday: 0,
      requiresSpintaxOrAi: policy.requiresSpintaxOrAi,
      lastEvaluatedAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Checks whether the connection can send automated messages according to maturation policy.
   */
  canSendAutomated(connectionId: string): {
    allowed: boolean;
    reason?: string;
    stage: MaturationStage;
    dailyCap: number;
    sentToday: number;
    remainingToday: number;
    minPacingSeconds: number;
    isFrozen: boolean;
  } {
    const state = this.getOrCreateState(connectionId);

    if (state.isFrozen) {
      return {
        allowed: false,
        reason: `Conexão congelada preventivamente devido a ${state.reportCount24h} denúncias/bloqueios em 24 horas (trava de segurança imediata).`,
        stage: state.stage,
        dailyCap: state.dailyCap,
        sentToday: state.sentToday,
        remainingToday: 0,
        minPacingSeconds: state.minPacingSeconds,
        isFrozen: true,
      };
    }

    if (state.stage === 'birth' || state.dailyCap === 0) {
      return {
        allowed: false,
        reason: `Conexão na Fase 1 (Nascimento, Dia ${state.currentDay}): disparos automatizados bloqueados. Apenas respostas manuais na Inbox são permitidas.`,
        stage: state.stage,
        dailyCap: state.dailyCap,
        sentToday: state.sentToday,
        remainingToday: 0,
        minPacingSeconds: state.minPacingSeconds,
        isFrozen: false,
      };
    }

    if (state.sentToday >= state.dailyCap) {
      return {
        allowed: false,
        reason: `Cota diária de maturação atingida (${state.sentToday}/${state.dailyCap} mensagens no Dia ${state.currentDay} - ${state.stage}).`,
        stage: state.stage,
        dailyCap: state.dailyCap,
        sentToday: state.sentToday,
        remainingToday: 0,
        minPacingSeconds: state.minPacingSeconds,
        isFrozen: false,
      };
    }

    return {
      allowed: true,
      stage: state.stage,
      dailyCap: state.dailyCap,
      sentToday: state.sentToday,
      remainingToday: Math.max(0, state.dailyCap - state.sentToday),
      minPacingSeconds: state.minPacingSeconds,
      isFrozen: false,
    };
  }

  /**
   * Records an automated send, incrementing sent_today and asserting quotas.
   */
  recordSend(connectionId: string): void {
    const check = this.canSendAutomated(connectionId);
    if (!check.allowed) {
      if (check.isFrozen) {
        throw new MaturationFrozenError(connectionId, check.reason);
      }
      throw new MaturationLimitExceededError(connectionId, check.dailyCap);
    }

    const nowIso = new Date().toISOString();
    this.conn
      .prepare(`
        UPDATE maturation_state
        SET sent_today = sent_today + 1,
            last_evaluated_at = ?,
            updated_at = ?
        WHERE connection_id = ?
      `)
      .run(nowIso, nowIso, connectionId);
  }

  /**
   * Records a user report or WhatsApp block incident.
   * If report count in 24h reaches >= 2, connection is frozen immediately.
   */
  recordIncident(
    connectionId: string,
    type: 'block' | 'complaint' | 'spam_report' = 'complaint',
    _details?: string
  ): { reportCount24h: number; isFrozen: boolean } {
    this.getOrCreateState(connectionId);
    const nowIso = new Date().toISOString();

    this.conn
      .prepare(`
        UPDATE maturation_state
        SET report_count_24h = report_count_24h + 1,
            last_evaluated_at = ?,
            updated_at = ?
        WHERE connection_id = ?
      `)
      .run(nowIso, nowIso, connectionId);

    const updated = this.getOrCreateState(connectionId);
    return {
      reportCount24h: updated.reportCount24h,
      isFrozen: updated.isFrozen,
    };
  }

  /**
   * Clears the incident count / unfreezes the connection.
   */
  resetIncidents(connectionId: string): void {
    this.getOrCreateState(connectionId);
    const nowIso = new Date().toISOString();

    this.conn
      .prepare(`
        UPDATE maturation_state
        SET report_count_24h = 0,
            last_evaluated_at = ?,
            updated_at = ?
        WHERE connection_id = ?
      `)
      .run(nowIso, nowIso, connectionId);
  }

  /**
   * Advances the connection to a specific day in the 21-day warm-up ramp,
   * re-evaluating stage policy and resetting daily quota.
   */
  setDay(connectionId: string, targetDay: number): MaturationState {
    this.getOrCreateState(connectionId);
    const safeDay = Math.max(1, Math.floor(targetDay));
    const policy = getPolicyForDay(safeDay);
    const nowIso = new Date().toISOString();

    this.conn
      .prepare(`
        UPDATE maturation_state
        SET current_day = ?,
            stage = ?,
            daily_cap = ?,
            sent_today = 0,
            last_evaluated_at = ?,
            updated_at = ?
        WHERE connection_id = ?
      `)
      .run(safeDay, policy.stage, policy.dailyCap, nowIso, nowIso, connectionId);

    return this.getOrCreateState(connectionId);
  }

  /**
   * Advances maturation by 1 day (or specified increment) and resets daily sent count.
   */
  advanceDay(connectionId: string, days = 1): MaturationState {
    const current = this.getOrCreateState(connectionId);
    return this.setDay(connectionId, current.currentDay + Math.max(1, days));
  }

  /**
   * Resets today's sent count to 0 (e.g. at midnight cron).
   */
  resetDailyUsage(connectionId: string): void {
    this.getOrCreateState(connectionId);
    const nowIso = new Date().toISOString();

    this.conn
      .prepare(`
        UPDATE maturation_state
        SET sent_today = 0,
            last_evaluated_at = ?,
            updated_at = ?
        WHERE connection_id = ?
      `)
      .run(nowIso, nowIso, connectionId);
  }

  private mapRow(row: MaturationRow): MaturationState {
    const policy = getPolicyForDay(row.current_day);
    const isFrozen = row.report_count_24h >= 2;
    const remainingToday = isFrozen ? 0 : Math.max(0, policy.dailyCap - row.sent_today);

    return {
      connectionId: row.connection_id,
      currentDay: row.current_day,
      stage: row.stage,
      sentToday: row.sent_today,
      dailyCap: policy.dailyCap,
      reportCount24h: row.report_count_24h,
      isFrozen,
      minPacingSeconds: policy.minPacingSeconds,
      remainingToday,
      requiresSpintaxOrAi: policy.requiresSpintaxOrAi,
      lastEvaluatedAt: new Date(row.last_evaluated_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
