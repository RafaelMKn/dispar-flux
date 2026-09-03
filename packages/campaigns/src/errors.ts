/**
 * Error hierarchy for @dispar-flux/campaigns
 */

export class CampaignEngineError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'CAMPAIGN_ENGINE_ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ContactNotFoundError extends CampaignEngineError {
  constructor(identifier: string) {
    super(`Contact not found: ${identifier}`, 'CONTACT_NOT_FOUND');
  }
}

export class BaseNotFoundError extends CampaignEngineError {
  constructor(baseId: string) {
    super(`Base not found: ${baseId}`, 'BASE_NOT_FOUND');
  }
}

export class CampaignNotFoundError extends CampaignEngineError {
  constructor(campaignId: string) {
    super(`Campaign not found: ${campaignId}`, 'CAMPAIGN_NOT_FOUND');
  }
}

export class CampaignStateError extends CampaignEngineError {
  constructor(message: string) {
    super(message, 'CAMPAIGN_STATE_ERROR');
  }
}

export class QueueBusyError extends CampaignEngineError {
  constructor(connectionId: string) {
    super(`Automation queue for connection "${connectionId}" is already processing an active job.`, 'QUEUE_BUSY');
  }
}

export class InvalidCsvError extends CampaignEngineError {
  public readonly row?: number;

  constructor(message: string, row?: number) {
    super(row ? `CSV Error at row ${row}: ${message}` : `CSV Error: ${message}`, 'INVALID_CSV');
    this.row = row;
  }
}

export class SuppressedContactError extends CampaignEngineError {
  public readonly normalizedPhone: string;

  constructor(normalizedPhone: string, reason: string) {
    super(`Contact ${normalizedPhone} is suppressed/opted-out: ${reason}`, 'SUPPRESSED_CONTACT');
    this.normalizedPhone = normalizedPhone;
  }
}
