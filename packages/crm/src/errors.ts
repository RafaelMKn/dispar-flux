import { DomainError } from '@dispar-flux/domain';

export class CrmError extends DomainError {
  constructor(message: string, code = 'CRM_ERROR') {
    super(message, code);
  }
}

/**
 * Thrown when attempting to create or activate more than 1 active Funnel in Community Edition (ADR 0037).
 */
export class CommunityEditionFunnelLimitError extends CrmError {
  constructor(
    message = 'Community Edition allows exactly 1 active Funnel per Organization (ADR 0037). Multiple funnels are a Commercial Feature.'
  ) {
    super(message, 'COMMUNITY_EDITION_FUNNEL_LIMIT');
  }
}

/**
 * Thrown when attempting to create a second Lead for the same Contact in the same Funnel (ADR 0038).
 */
export class DuplicateLeadError extends CrmError {
  constructor(contactId: string, funnelId: string) {
    super(
      `Contact "${contactId}" already has an active Lead in Funnel "${funnelId}" (ADR 0038: strictly 1 Lead per Contact per Funnel).`,
      'DUPLICATE_LEAD_IN_FUNNEL'
    );
  }
}

export class InvalidStageError extends CrmError {
  constructor(message: string) {
    super(message, 'INVALID_STAGE');
  }
}

export class LeadNotFoundError extends CrmError {
  constructor(leadId: string) {
    super(`Lead "${leadId}" not found`, 'LEAD_NOT_FOUND');
  }
}

export class FunnelNotFoundError extends CrmError {
  constructor(funnelId: string) {
    super(`Funnel "${funnelId}" not found`, 'FUNNEL_NOT_FOUND');
  }
}

export class AppointmentConflictError extends CrmError {
  constructor(message: string) {
    super(message, 'APPOINTMENT_CONFLICT');
  }
}

export class InvalidAppointmentTimeError extends CrmError {
  constructor(message: string) {
    super(message, 'INVALID_APPOINTMENT_TIME');
  }
}

export class SafetyFloorQueueError extends CrmError {
  constructor(message: string) {
    super(message, 'SAFETY_FLOOR_QUEUE_VIOLATION');
  }
}
