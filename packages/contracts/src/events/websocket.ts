import type { CampaignStatus, MessageDirection, MessageKind, MessageType } from '@dispar-flux/domain';

export interface WebSocketEnvelope<TType extends string, TPayload> {
  id: string;
  type: TType;
  timestamp: string; // ISO 8601
  payload: TPayload;
}

// 1. System Events
export type SystemEventType =
  | 'system.status_changed'
  | 'system.maintenance_warning'
  | 'system.storage_warning';

export interface SystemEventPayload {
  status: string;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export type SystemEvent = WebSocketEnvelope<SystemEventType, SystemEventPayload>;

// 2. Connection Events
export type ConnectionEventType =
  | 'connection.connecting'
  | 'connection.qr'
  | 'connection.connected'
  | 'connection.disconnected'
  | 'connection.failed';

export interface ConnectionEventPayload {
  connectionId: string;
  status: 'connecting' | 'qr' | 'connected' | 'disconnected' | 'failed';
  qrCode?: string; // QR code data string for pairing
  disconnectReason?: string;
}

export type ConnectionEvent = WebSocketEnvelope<ConnectionEventType, ConnectionEventPayload>;

// 3. Campaign Events
export type CampaignEventType =
  | 'campaign.started'
  | 'campaign.progress'
  | 'campaign.paused'
  | 'campaign.completed'
  | 'campaign.failed'
  | 'campaign.safety_ceiling_reached';

export interface CampaignEventPayload {
  campaignId: string;
  status: CampaignStatus | 'safety_ceiling_reached';
  sentCount: number;
  failedCount: number;
  unknownCount: number;
  totalCount: number;
  progressPercent: number;
  errorReason?: string;
}

export type CampaignEvent = WebSocketEnvelope<CampaignEventType, CampaignEventPayload>;

// 4. Message Events
export type MessageEventType =
  | 'message.received'
  | 'message.sent'
  | 'message.delivered'
  | 'message.read'
  | 'message.failed';

export interface MessageEventPayload {
  messageId: string;
  conversationId: string;
  contactId: string;
  connectionId: string;
  direction: MessageDirection;
  type: MessageType;
  kind: MessageKind;
  content: string;
  status: string;
  timestamp: string;
}

export type MessageEvent = WebSocketEnvelope<MessageEventType, MessageEventPayload>;

// Discriminated Union of all WebSocket events
export type DisparWebSocketEvent =
  | SystemEvent
  | ConnectionEvent
  | CampaignEvent
  | MessageEvent;

export function createWebSocketEvent<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  id?: string
): WebSocketEnvelope<TType, TPayload> {
  return {
    id: id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function isWebSocketEvent(data: unknown): data is DisparWebSocketEvent {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['type'] === 'string' &&
    typeof candidate['timestamp'] === 'string' &&
    typeof candidate['payload'] === 'object' &&
    candidate['payload'] !== null
  );
}
