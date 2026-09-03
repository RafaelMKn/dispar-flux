import type { Conversation } from '@dispar-flux/domain';
import { ConversationRepository } from '../repositories/conversation-repository.js';
import { MessageRepository } from '../repositories/message-repository.js';
import type { PaginatedResult } from '../types.js';

export class ConversationService {
  constructor(
    private readonly conversationRepo: ConversationRepository,
    private readonly messageRepo: MessageRepository
  ) {}

  /**
   * Retrieves or creates a conversation partitioned strictly by (connectionId, contactId).
   * Enforces ADR 0039: Each connection has an isolated conversation per contact.
   */
  getOrCreateConversation(
    organizationId: string,
    connectionId: string,
    contactId: string
  ): Conversation {
    const existing = this.conversationRepo.findByConnectionAndContact(connectionId, contactId);
    if (existing) {
      return existing;
    }

    return this.conversationRepo.create({
      organizationId,
      connectionId,
      contactId,
      unreadCount: 0,
    });
  }

  getConversation(id: string): Conversation | null {
    return this.conversationRepo.findById(id);
  }

  getConversationByConnectionAndContact(
    connectionId: string,
    contactId: string
  ): Conversation | null {
    return this.conversationRepo.findByConnectionAndContact(connectionId, contactId);
  }

  listConversations(params: {
    organizationId: string;
    connectionId?: string;
    contactId?: string;
    limit?: number;
    offset?: number;
  }): PaginatedResult<Conversation> {
    const limit = Math.max(1, Math.min(params.limit ?? 50, 100));
    const offset = Math.max(0, params.offset ?? 0);

    const result = this.conversationRepo.listByOrganization({
      organizationId: params.organizationId,
      connectionId: params.connectionId,
      contactId: params.contactId,
      limit,
      offset,
    });

    return {
      items: result.conversations,
      total: result.total,
      limit,
      offset,
    };
  }

  /**
   * Aggregates all conversations for a contact across all messaging connections.
   * Preserves partition boundaries while enabling a unified chronological view in the UI (ADR 0039).
   */
  getContactAggregatedConversations(
    organizationId: string,
    contactId: string
  ): Conversation[] {
    return this.conversationRepo.listByContact(organizationId, contactId);
  }

  /**
   * Resets the unread counter and synchronizes status of all inbound messages to 'read'.
   */
  markAsRead(conversationId: string): { conversation: Conversation; readCount: number } {
    const conv = this.conversationRepo.findById(conversationId);
    if (!conv) {
      throw new Error(`Conversation not found with ID "${conversationId}"`);
    }

    const readCount = this.messageRepo.markMessagesAsRead(conversationId);
    this.conversationRepo.resetUnread(conversationId);

    const updated = this.conversationRepo.findById(conversationId)!;
    return {
      conversation: updated,
      readCount,
    };
  }

  incrementUnread(conversationId: string): void {
    this.conversationRepo.incrementUnread(conversationId);
  }

  touchLastMessage(conversationId: string, timestamp: Date): void {
    this.conversationRepo.updateLastMessage(conversationId, timestamp);
  }
}
