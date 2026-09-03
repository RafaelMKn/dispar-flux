import { InvariantViolationError } from '../errors/domain-errors.js';

export type MessageDirection = 'inbound' | 'outbound';
export type MessageType = 'manual' | 'automated';
export type MessageKind = 'inbound' | 'outbound' | 'manual' | 'automated';
export type MessageDeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Conversation {
  id: string;
  organizationId: string;
  connectionId: string;
  contactId: string;
  unreadCount: number;
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationParams {
  id: string;
  organizationId: string;
  connectionId: string;
  contactId: string;
  unreadCount?: number;
  lastMessageAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createConversation(params: CreateConversationParams): Conversation {
  if (!params.organizationId) throw new InvariantViolationError('Organization ID is required');
  if (!params.connectionId) throw new InvariantViolationError('Connection ID is required');
  if (!params.contactId) throw new InvariantViolationError('Contact ID is required');

  const now = new Date();
  return {
    id: params.id,
    organizationId: params.organizationId,
    connectionId: params.connectionId,
    contactId: params.contactId,
    unreadCount: params.unreadCount ?? 0,
    lastMessageAt: params.lastMessageAt,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}

export interface Message {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  kind: MessageKind;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  externalId?: string; // Provider ID (e.g. Baileys / WhatsApp message key id)
  senderMemberId?: string; // If manual response from operator/owner
  campaignJobId?: string; // If automated campaign dispatch
  status: MessageDeliveryStatus;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  createdAt: Date;
}

export interface CreateMessageParams {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  externalId?: string;
  senderMemberId?: string;
  campaignJobId?: string;
  status?: MessageDeliveryStatus;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  createdAt?: Date;
}

export function createMessage(params: CreateMessageParams): Message {
  if (!params.conversationId) throw new InvariantViolationError('Conversation ID is required');
  if (params.content === undefined && !params.mediaUrl) {
    throw new InvariantViolationError('Message content or media URL is required');
  }

  // Determine single kind representation
  let kind: MessageKind = params.direction;
  if (params.direction === 'outbound') {
    kind = params.type === 'manual' ? 'manual' : 'automated';
  }

  const now = new Date();
  return {
    id: params.id,
    conversationId: params.conversationId,
    direction: params.direction,
    type: params.type,
    kind,
    content: params.content,
    mediaUrl: params.mediaUrl,
    mediaType: params.mediaType,
    externalId: params.externalId,
    senderMemberId: params.senderMemberId,
    campaignJobId: params.campaignJobId,
    status: params.status ?? 'pending',
    sentAt: params.sentAt,
    deliveredAt: params.deliveredAt,
    readAt: params.readAt,
    createdAt: params.createdAt ?? now,
  };
}
