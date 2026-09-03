import type { DatabaseConnection } from '@dispar-flux/database';
import {
  normalizePhoneNumber,
  type Conversation,
  type Message,
  type MessageDeliveryStatus,
} from '@dispar-flux/domain';
import { ConversationService } from './conversation-service.js';
import { MessageRepository } from '../repositories/message-repository.js';
import { LidJidRepository } from '../repositories/lid-jid-repository.js';
import type {
  InboundMessageParams,
  PaginatedResult,
  PaginationOptions,
  SearchMessagesOptions,
} from '../types.js';

export interface AttributedSendCandidate {
  messageId: string;
  campaignJobId: string;
  sentAt: Date;
  isAmbiguous: boolean;
}

export class MessageService {
  constructor(
    private readonly conn: DatabaseConnection,
    private readonly conversationService: ConversationService,
    private readonly messageRepo: MessageRepository,
    private readonly lidJidRepo: LidJidRepository
  ) {}

  /**
   * Resolves an incoming protocol identifier (JID, LID, or phone) to a Contact ID.
   * Auto-creates a new Contact record if not yet registered in the organization.
   */
  resolveOrCreateContact(organizationId: string, identifier: string, fallbackName?: string): {
    contactId: string;
    normalizedPhone: string;
  } {
    const resolved = this.lidJidRepo.resolveIdentifier(organizationId, identifier);
    if (resolved) {
      return {
        contactId: resolved.contactId,
        normalizedPhone: resolved.normalizedPhone,
      };
    }

    // Extract phone number if JID or raw number
    let rawPhone = identifier.trim();
    if (rawPhone.includes('@s.whatsapp.net') || rawPhone.includes('@c.us')) {
      rawPhone = rawPhone.split('@')[0] || '';
    }

    let normalizedPhone: string;
    try {
      const norm = normalizePhoneNumber(rawPhone);
      normalizedPhone = norm.isValid ? norm.digits : rawPhone.replace(/\D/g, '');
      if (!normalizedPhone) {
        normalizedPhone = `lid_${rawPhone.replace(/[^a-zA-Z0-9]/g, '')}`;
      }
    } catch {
      // If it's an LID that wasn't found in mappings, use pseudo-identifier for contact
      normalizedPhone = `lid_${rawPhone.replace(/[^a-zA-Z0-9]/g, '')}`;
    }

    // Check if contact already exists with this phone
    const existing = this.conn
      .prepare('SELECT id, normalized_phone FROM contacts WHERE organization_id = ? AND normalized_phone = ?')
      .get(organizationId, normalizedPhone) as { id: string; normalized_phone: string } | undefined;

    if (existing) {
      this.lidJidRepo.registerMapping({
        organizationId,
        contactId: existing.id,
        jid: identifier.includes('@s.whatsapp.net') ? identifier : undefined,
        lid: identifier.includes('@lid') ? identifier : undefined,
        normalizedPhone,
      });
      return { contactId: existing.id, normalizedPhone: existing.normalized_phone };
    }

    // Create new contact
    const contactId = `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    this.conn
      .prepare(`
        INSERT INTO contacts (
          id, organization_id, normalized_phone, name, custom_fields,
          is_opted_out, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '{}', 0, ?, ?)
      `)
      .run(contactId, organizationId, normalizedPhone, fallbackName || null, now, now);

    this.lidJidRepo.registerMapping({
      organizationId,
      contactId,
      jid: identifier.includes('@s.whatsapp.net') ? identifier : undefined,
      lid: identifier.includes('@lid') ? identifier : undefined,
      normalizedPhone,
    });

    return { contactId, normalizedPhone };
  }

  /**
   * Evaluates ADR 0042: checks for relevant unanswered automated campaign sends
   * in the conversation to which this incoming message responds.
   */
  findAttributableSend(conversationId: string): AttributedSendCandidate | null {
    // Find the most recent outbound automated message in this conversation with a campaignJobId
    const rows = this.conn
      .prepare(`
        SELECT id, campaign_job_id, sent_at, created_at
        FROM messages
        WHERE conversation_id = ?
          AND direction = 'outbound'
          AND type = 'automated'
          AND campaign_job_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 2
      `)
      .all(conversationId) as unknown as {
        id: string;
        campaign_job_id: string;
        sent_at: string | null;
        created_at: string;
      }[];

    if (rows.length === 0) {
      return null;
    }

    const latest = rows[0]!;
    // If multiple recent automated jobs exist without clear separation, mark as ambiguous
    const isAmbiguous = rows.length > 1 && Boolean(rows[1]?.campaign_job_id);

    return {
      messageId: latest.id,
      campaignJobId: latest.campaign_job_id,
      sentAt: latest.sent_at ? new Date(latest.sent_at) : new Date(latest.created_at),
      isAmbiguous,
    };
  }

  /**
   * Handles receiving an inbound message from a messaging connector.
   * Resolves JID/LID to canonical Contact, finds/creates conversation,
   * updates unread counter, and evaluates ADR 0042 response attribution.
   */
  async receiveInboundMessage(params: InboundMessageParams): Promise<{
    message: Message;
    conversation: Conversation;
    contactId: string;
    attribution: AttributedSendCandidate | null;
  }> {
    const { contactId } = this.resolveOrCreateContact(
      params.organizationId,
      params.senderIdentifier
    );

    // Get or create isolated conversation for (connectionId, contactId) (ADR 0039)
    const conversation = this.conversationService.getOrCreateConversation(
      params.organizationId,
      params.connectionId,
      contactId
    );

    // Persist inbound message
    const now = params.sentAt || new Date();
    const message = this.messageRepo.create({
      id: undefined as any,
      conversationId: conversation.id,
      direction: 'inbound',
      type: 'manual', // Inbound messages are marked manual
      content: params.content,
      externalId: params.externalId,
      mediaUrl: params.mediaUrl,
      mediaType: params.mediaType,
      status: 'delivered',
      sentAt: now,
      deliveredAt: now,
      createdAt: now,
    });

    // Update conversation unread count and last message timestamp
    this.conversationService.incrementUnread(conversation.id);
    this.conversationService.touchLastMessage(conversation.id, message.createdAt);

    // Evaluate ADR 0042 response attribution
    const attribution = this.findAttributableSend(conversation.id);

    return {
      message,
      conversation,
      contactId,
      attribution,
    };
  }

  /**
   * Updates delivery status of a message ('sent' -> 'delivered' -> 'read' or 'failed').
   */
  updateDeliveryStatus(
    messageId: string,
    status: MessageDeliveryStatus,
    timestamp: Date = new Date()
  ): Message {
    const updated = this.messageRepo.updateDeliveryStatus(messageId, status, timestamp);
    if (!updated) {
      throw new Error(`Message with ID "${messageId}" not found for status update`);
    }
    return updated;
  }

  /**
   * Retrieves paginated messages in a conversation.
   */
  listMessages(
    conversationId: string,
    options: PaginationOptions = {}
  ): PaginatedResult<Message> {
    return this.messageRepo.listByConversation(conversationId, options);
  }

  /**
   * Searches messages across conversations or within a specific conversation.
   */
  searchMessages(options: SearchMessagesOptions): PaginatedResult<Message> {
    return this.messageRepo.search(options);
  }
}
