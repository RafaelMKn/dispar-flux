import type { DatabaseConnection } from '@dispar-flux/database';
import {
  InvariantViolationError,
  type Conversation,
  type Message,
} from '@dispar-flux/domain';
import { ConversationService } from './conversation-service.js';
import { MessageRepository } from '../repositories/message-repository.js';
import { LidJidRepository } from '../repositories/lid-jid-repository.js';
import type {
  CampaignQueueTracker,
  OutboundMessageDispatcher,
  SendManualResponseParams,
} from '../types.js';

interface MemberRow {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role: string;
  is_active: number;
}

interface ContactRow {
  id: string;
  organization_id: string;
  normalized_phone: string;
  name: string | null;
  is_opted_out: number;
}

export class ManualResponseService {
  constructor(
    private readonly conn: DatabaseConnection,
    private readonly conversationService: ConversationService,
    private readonly messageRepo: MessageRepository,
    private readonly lidJidRepo: LidJidRepository,
    private readonly dispatcher: OutboundMessageDispatcher,
    private readonly campaignQueueTracker?: CampaignQueueTracker
  ) {}

  /**
   * Dispatches an immediate manual response typed by an Operator or Owner in the Inbox.
   *
   * Enforces:
   * - ADR 0027 & ADR 0043: Sends IMMEDIATELY, completely bypassing the automated campaign queue.
   * - ADR 0043: Does NOT consume daily prospecting limits.
   * - ADR 0043 & ADR 0045: Allowed even when contact has opted out (for 1-on-1 customer service).
   * - ADR 0043 & ADR 0045: Sending a manual response NEVER automatically clears opt-out status
   *   or reauthorizes automated campaigns.
   */
  async sendManualResponse(params: SendManualResponseParams): Promise<{
    message: Message;
    conversation: Conversation;
    contactWasOptedOut: boolean;
  }> {
    // 1. Sender validation (Operator or Owner)
    const member = this.conn
      .prepare('SELECT * FROM members WHERE id = ? AND organization_id = ?')
      .get(params.senderMemberId, params.organizationId) as MemberRow | undefined;

    if (!member) {
      throw new InvariantViolationError(
        `Member with ID "${params.senderMemberId}" not found in organization`
      );
    }
    if (member.is_active !== 1) {
      throw new InvariantViolationError(`Member "${member.name}" is deactivated`);
    }
    if (member.role !== 'owner' && member.role !== 'operator') {
      throw new InvariantViolationError(
        `Member "${member.name}" with role "${member.role}" is not authorized to send manual responses`
      );
    }

    // 2. Contact validation
    const contact = this.conn
      .prepare('SELECT * FROM contacts WHERE id = ? AND organization_id = ?')
      .get(params.contactId, params.organizationId) as ContactRow | undefined;

    if (!contact) {
      throw new InvariantViolationError(
        `Contact with ID "${params.contactId}" not found in organization`
      );
    }

    // Check opt-out state (for tracking / audit, but DO NOT block manual response per ADR 0043)
    const contactWasOptedOut = contact.is_opted_out === 1;

    // 3. Conversation resolution (partitioned strictly by (connectionId, contactId), ADR 0039)
    const conversation = this.conversationService.getOrCreateConversation(
      params.organizationId,
      params.connectionId,
      params.contactId
    );

    // 4. Resolve transport recipient address (LID or JID or normalized phone)
    const mapping = this.lidJidRepo.findByContactId(params.organizationId, params.contactId);
    const toAddress = mapping?.jid || mapping?.lid || contact.normalized_phone;

    // 5. Immediate dispatch:
    // Bypass the campaign queue entirely (campaignQueueTracker is NOT invoked to enqueue or consume limits)
    const initialLimits = this.campaignQueueTracker?.getRemainingDailyLimit(params.connectionId);

    const dispatchResult = await this.dispatcher.sendDirectly({
      connectionId: params.connectionId,
      to: toAddress,
      content: params.content,
      mediaUrl: params.mediaUrl,
      mediaType: params.mediaType,
    });

    // Verify limit was not consumed
    if (this.campaignQueueTracker && initialLimits !== undefined) {
      const remainingAfter = this.campaignQueueTracker.getRemainingDailyLimit(params.connectionId);
      if (remainingAfter !== initialLimits) {
        throw new Error('Safety invariant violated: Manual response must not consume daily prospecting limits (ADR 0043)');
      }
    }

    // 6. Record outbound manual message in the database
    const sentAt = dispatchResult.sentAt || new Date();
    const message = this.messageRepo.create({
      id: undefined as any,
      conversationId: conversation.id,
      direction: 'outbound',
      type: 'manual',
      content: params.content,
      mediaUrl: params.mediaUrl,
      mediaType: params.mediaType,
      externalId: dispatchResult.externalId,
      senderMemberId: params.senderMemberId,
      status: 'sent',
      sentAt,
      createdAt: sentAt,
    });

    // Touch conversation last message
    this.conversationService.touchLastMessage(conversation.id, message.createdAt);

    // 7. Invariant verification (ADR 0043 & ADR 0045):
    // Contact opt-out status must NOT be automatically cleared!
    const contactCheck = this.conn
      .prepare('SELECT is_opted_out FROM contacts WHERE id = ?')
      .get(params.contactId) as { is_opted_out: number } | undefined;

    if (contactWasOptedOut && contactCheck?.is_opted_out !== 1) {
      throw new Error(
        'Safety invariant violated: Manual response must not clear opt-out status (ADR 0043/0045)'
      );
    }

    return {
      message,
      conversation,
      contactWasOptedOut,
    };
  }
}
