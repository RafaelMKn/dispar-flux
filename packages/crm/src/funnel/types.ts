import type { FunnelStage } from '@dispar-flux/domain';

export type { FunnelStage };

export interface CrmFunnel {
  id: string;
  organizationId: string;
  name: string;
  stages: FunnelStage[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFunnelInput {
  id?: string;
  organizationId: string;
  name: string;
  stages?: FunnelStage[];
  isActive?: boolean;
}

export interface UpdateFunnelInput {
  name?: string;
  stages?: FunnelStage[];
  isActive?: boolean;
}

/**
 * Standard default stages for Dispar Flux commercial pipeline.
 * Order 0 ("novo") is the default entry stage.
 * Order 1 ("em andamento") is the first-response destination stage (ADR 0042).
 */
export const DEFAULT_COMMERCIAL_STAGES: FunnelStage[] = [
  { id: 'stage-novo', name: 'novo', order: 0 },
  { id: 'stage-em-andamento', name: 'em andamento', order: 1 },
  { id: 'stage-agendado', name: 'agendado', order: 2 },
  { id: 'stage-ganho', name: 'ganho', order: 3 },
  { id: 'stage-perdido', name: 'perdido', order: 4 },
];

/**
 * Resolves the initial stage of a funnel (lowest order or named "novo").
 */
export function getInitialStage(funnel: CrmFunnel): FunnelStage {
  if (!funnel.stages || funnel.stages.length === 0) {
    throw new Error(`Funnel "${funnel.id}" has no stages defined`);
  }
  const byName = funnel.stages.find((s) => s.name.trim().toLowerCase() === 'novo');
  if (byName) return byName;
  const sorted = [...funnel.stages].sort((a, b) => a.order - b.order);
  const first = sorted[0];
  if (!first) throw new Error(`Funnel "${funnel.id}" has no valid stage`);
  return first;
}

/**
 * Resolves the in-progress stage of a funnel (named "em andamento" or second lowest order).
 */
export function getInProgressStage(funnel: CrmFunnel): FunnelStage {
  if (!funnel.stages || funnel.stages.length === 0) {
    throw new Error(`Funnel "${funnel.id}" has no stages defined`);
  }
  const byName = funnel.stages.find((s) => s.name.trim().toLowerCase() === 'em andamento');
  if (byName) return byName;
  const sorted = [...funnel.stages].sort((a, b) => a.order - b.order);
  const second = sorted[1] ?? sorted[0];
  if (!second) throw new Error(`Funnel "${funnel.id}" has no valid stage`);
  return second;
}
