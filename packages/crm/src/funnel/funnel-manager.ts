import crypto from 'node:crypto';
import { InvariantViolationError } from '@dispar-flux/domain';
import {
  type CrmFunnel,
  type FunnelStage,
  type CreateFunnelInput,
  type UpdateFunnelInput,
  DEFAULT_COMMERCIAL_STAGES,
} from './types.js';
import {
  CommunityEditionFunnelLimitError,
  FunnelNotFoundError,
  InvalidStageError,
} from '../errors.js';

export interface FunnelManagerOptions {
  edition?: 'community' | 'enterprise';
}

export class FunnelManager {
  private readonly funnels = new Map<string, CrmFunnel>();
  public readonly edition: 'community' | 'enterprise';

  constructor(options: FunnelManagerOptions = {}) {
    this.edition = options.edition ?? 'community';
  }

  /**
   * Creates a new Funnel with ordered stages.
   * Enforces ADR 0037: strictly 1 active Funnel per Organization in Community Edition.
   */
  createFunnel(input: CreateFunnelInput): CrmFunnel {
    const name = input.name?.trim();
    if (!name) {
      throw new InvariantViolationError('Funnel name cannot be empty');
    }
    if (!input.organizationId) {
      throw new InvariantViolationError('Organization ID is required');
    }

    const isActive = input.isActive ?? true;

    // Invariant ADR 0037: Community Edition permits only 1 active funnel per organization
    if (this.edition === 'community' && isActive) {
      const existingActive = this.getActiveFunnel(input.organizationId);
      if (existingActive) {
        throw new CommunityEditionFunnelLimitError();
      }
    }

    const stages: FunnelStage[] = (input.stages && input.stages.length > 0)
      ? input.stages
      : DEFAULT_COMMERCIAL_STAGES.map((s) => ({ ...s }));

    this.validateStages(stages);
    const sortedStages = [...stages].sort((a, b) => a.order - b.order);

    const now = new Date();
    const funnel: CrmFunnel = {
      id: input.id ?? `fnl-${crypto.randomUUID()}`,
      organizationId: input.organizationId,
      name,
      stages: sortedStages,
      isActive,
      createdAt: now,
      updatedAt: now,
    };

    this.funnels.set(funnel.id, funnel);
    return funnel;
  }

  /**
   * Retrieves a Funnel by ID.
   */
  getFunnel(funnelId: string): CrmFunnel | undefined {
    return this.funnels.get(funnelId);
  }

  /**
   * Retrieves the active Funnel for an organization.
   */
  getActiveFunnel(organizationId: string): CrmFunnel | undefined {
    for (const f of this.funnels.values()) {
      if (f.organizationId === organizationId && f.isActive) {
        return f;
      }
    }
    return undefined;
  }

  /**
   * Lists all funnels for an organization.
   */
  listFunnels(organizationId: string): CrmFunnel[] {
    const list: CrmFunnel[] = [];
    for (const f of this.funnels.values()) {
      if (f.organizationId === organizationId) {
        list.push(f);
      }
    }
    return list;
  }

  /**
   * Activates a Funnel.
   * If in Community Edition, ensures no other funnel is active.
   */
  activateFunnel(funnelId: string): CrmFunnel {
    const funnel = this.getFunnel(funnelId);
    if (!funnel) {
      throw new FunnelNotFoundError(funnelId);
    }

    if (funnel.isActive) {
      return funnel;
    }

    if (this.edition === 'community') {
      const activeFunnel = this.getActiveFunnel(funnel.organizationId);
      if (activeFunnel && activeFunnel.id !== funnelId) {
        throw new CommunityEditionFunnelLimitError();
      }
    }

    const updated: CrmFunnel = {
      ...funnel,
      isActive: true,
      updatedAt: new Date(),
    };
    this.funnels.set(funnelId, updated);
    return updated;
  }

  /**
   * Deactivates a Funnel.
   */
  deactivateFunnel(funnelId: string): CrmFunnel {
    const funnel = this.getFunnel(funnelId);
    if (!funnel) {
      throw new FunnelNotFoundError(funnelId);
    }

    const updated: CrmFunnel = {
      ...funnel,
      isActive: false,
      updatedAt: new Date(),
    };
    this.funnels.set(funnelId, updated);
    return updated;
  }

  /**
   * Updates basic attributes of a Funnel.
   */
  updateFunnel(funnelId: string, input: UpdateFunnelInput): CrmFunnel {
    const funnel = this.getFunnel(funnelId);
    if (!funnel) {
      throw new FunnelNotFoundError(funnelId);
    }

    if (input.isActive !== undefined && input.isActive && !funnel.isActive) {
      return this.activateFunnel(funnelId);
    }

    let stages = funnel.stages;
    if (input.stages) {
      this.validateStages(input.stages);
      stages = [...input.stages].sort((a, b) => a.order - b.order);
    }

    const updated: CrmFunnel = {
      ...funnel,
      name: input.name?.trim() || funnel.name,
      stages,
      isActive: input.isActive ?? funnel.isActive,
      updatedAt: new Date(),
    };
    this.funnels.set(funnelId, updated);
    return updated;
  }

  /**
   * Adds a new stage to an existing Funnel.
   */
  addStage(funnelId: string, stage: FunnelStage): CrmFunnel {
    const funnel = this.getFunnel(funnelId);
    if (!funnel) {
      throw new FunnelNotFoundError(funnelId);
    }

    if (funnel.stages.some((s) => s.id === stage.id)) {
      throw new InvalidStageError(`Stage with ID "${stage.id}" already exists in funnel "${funnelId}"`);
    }

    const newStages = [...funnel.stages, stage].sort((a, b) => a.order - b.order);
    this.validateStages(newStages);

    const updated: CrmFunnel = {
      ...funnel,
      stages: newStages,
      updatedAt: new Date(),
    };
    this.funnels.set(funnelId, updated);
    return updated;
  }

  /**
   * Reorders stages of a Funnel.
   */
  reorderStages(funnelId: string, stageOrders: { id: string; order: number }[]): CrmFunnel {
    const funnel = this.getFunnel(funnelId);
    if (!funnel) {
      throw new FunnelNotFoundError(funnelId);
    }

    const orderMap = new Map<string, number>(stageOrders.map((s) => [s.id, s.order]));
    const updatedStages = funnel.stages.map((s) => {
      const newOrder = orderMap.get(s.id);
      return newOrder !== undefined ? { ...s, order: newOrder } : s;
    });

    this.validateStages(updatedStages);
    const sorted = [...updatedStages].sort((a, b) => a.order - b.order);

    const updated: CrmFunnel = {
      ...funnel,
      stages: sorted,
      updatedAt: new Date(),
    };
    this.funnels.set(funnelId, updated);
    return updated;
  }

  private validateStages(stages: FunnelStage[]): void {
    if (!stages || stages.length === 0) {
      throw new InvariantViolationError('Funnel must have at least one stage');
    }
    const ids = new Set<string>();
    for (const s of stages) {
      if (!s.id?.trim()) throw new InvariantViolationError('Stage ID cannot be empty');
      if (!s.name?.trim()) throw new InvariantViolationError('Stage name cannot be empty');
      if (typeof s.order !== 'number') throw new InvariantViolationError('Stage order must be a number');
      if (ids.has(s.id)) throw new InvalidStageError(`Duplicate stage ID "${s.id}" in funnel`);
      ids.add(s.id);
    }
  }
}
