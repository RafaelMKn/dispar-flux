import type {
  Conversation,
  Message,
  MessageDeliveryStatus,
  MessageDirection,
  MessageKind,
  MessageType,
} from '@dispar-flux/domain';

export interface SendOutboundResult {
  externalId: string;
  sentAt: Date;
}

/**
 * Direct messaging transport interface for immediate dispatch.
 */
export interface OutboundMessageDispatcher {
  sendDirectly(params: {
    connectionId: string;
    to: string; // Phone, JID or LID
    content: string;
    mediaUrl?: string;
    mediaType?: string;
  }): Promise<SendOutboundResult>;
}

/**
 * Interface representing the automated campaign queue and daily limits tracker.
 * Manual responses from operators explicitly bypass this queue and do not consume limits (ADR 0043).
 */
export interface CampaignQueueTracker {
  getRemainingDailyLimit(connectionId: string): number;
  consumeDailyLimit(connectionId: string, count?: number): void;
  enqueueCampaignJob(params: {
    campaignId: string;
    jobId: string;
    connectionId: string;
    to: string;
    content: string;
  }): Promise<void>;
  getDailySendsCount(connectionId: string): number;
}

export interface PaginationOptions {
  /**
   * Number of items per page. Defaults to 50.
   */
  limit?: number;

  /**
   * Offset for offset-based pagination.
   */
  offset?: number;

  /**
   * Cursor for cursor-based pagination (opaque token or message ID / timestamp).
   */
  cursor?: string;

  /**
   * Sort direction. Defaults to 'asc' (chronological order) for chat threads.
   */
  direction?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset?: number;
  nextCursor?: string;
  prevCursor?: string;
}

export interface SearchMessagesOptions {
  organizationId: string;
  query: string;
  conversationId?: string;
  connectionId?: string;
  contactId?: string;
  limit?: number;
  offset?: number;
}

export interface SendManualResponseParams {
  organizationId: string;
  connectionId: string;
  contactId: string;
  senderMemberId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
}

export interface InboundMessageParams {
  organizationId: string;
  connectionId: string;
  senderIdentifier: string; // phone number, JID, or LID
  content: string;
  externalId?: string;
  mediaUrl?: string;
  mediaType?: string;
  sentAt?: Date;
}

export interface LidJidMappingRecord {
  id: string;
  organizationId: string;
  contactId: string;
  jid?: string;
  lid?: string;
  normalizedPhone?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedContactIdentifier {
  contactId: string;
  normalizedPhone: string;
  jid?: string;
  lid?: string;
}
