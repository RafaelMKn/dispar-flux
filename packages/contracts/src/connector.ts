export type ConnectionStatus = 'connecting' | 'qr' | 'connected' | 'disconnected' | 'failed';

export interface ConnectOptions {
  dataDir?: string;
  authDir?: string;
  browser?: [string, string, string];
  printQRInTerminal?: boolean;
  logger?: unknown;
  markOnlineOnConnect?: boolean;
  replaceExisting?: boolean;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  socketFactory?: (config: any) => any;
  authStateFactory?: (authDir: string) => Promise<{ state: any; saveCreds: () => Promise<void> }>;
}

export interface SendMessageParams {
  connectionId: string;
  to: string; // E.164 phone number or JID
  content: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'document';
  mediaUrl?: string;
  mediaBuffer?: Buffer | Uint8Array;
  mediaType?: string; // MIME type
  fileName?: string;
  caption?: string;
  quotedMessageId?: string;
}

export interface SendResult {
  messageId: string; // External provider message ID (e.g. Baileys key ID)
  connectionId: string;
  to: string;
  status: 'sent' | 'pending' | 'delivered' | 'failed';
  timestamp: Date;
}

export interface InboundMessage {
  messageId: string;
  connectionId: string;
  from: string; // Canonical identifier / normalized phone number
  remoteJid: string; // Provider remote JID
  participant?: string;
  content: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'other';
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
  timestamp: Date;
  isLid?: boolean;
  raw?: unknown;
}

export interface QREventPayload {
  connectionId: string;
  qr: string;
}

export interface StatusEventPayload {
  connectionId: string;
  status: ConnectionStatus;
  disconnectReason?: string;
  error?: Error;
}

export interface MessagingConnector {
  connect(connectionId: string, options?: ConnectOptions): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  sendMessage(params: SendMessageParams): Promise<SendResult>;
  getStatus(connectionId: string): ConnectionStatus;
  on(event: 'qr', listener: (payload: QREventPayload) => void): void;
  on(event: 'status', listener: (payload: StatusEventPayload) => void): void;
  on(event: 'message', listener: (message: InboundMessage) => void): void;
  on(event: 'error', listener: (error: Error, connectionId?: string) => void): void;
  on(event: 'qr' | 'status' | 'message' | 'error', listener: Function): void;
}
