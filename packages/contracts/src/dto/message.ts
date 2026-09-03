import type { MessageDirection, MessageType, MessageKind, MessageDeliveryStatus } from '@dispar-flux/domain';

export interface SendMessageRequest {
  conversationId?: string;
  contactId?: string;
  connectionId?: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  kind: MessageKind;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  status: MessageDeliveryStatus;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
}

export interface ConversationResponse {
  id: string;
  organizationId: string;
  connectionId: string;
  contactId: string;
  unreadCount: number;
  lastMessageAt?: string;
  createdAt: string;
}

export interface ListMessagesResponse {
  messages: MessageResponse[];
  total: number;
  limit: number;
  offset: number;
}
