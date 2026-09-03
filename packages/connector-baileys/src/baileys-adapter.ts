import { EventEmitter } from 'node:events';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type AnyMessageContent,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import type {
  MessagingConnector,
  ConnectOptions,
  SendMessageParams,
  SendResult,
  ConnectionStatus,
  InboundMessage,
  QREventPayload,
  StatusEventPayload,
} from '@dispar-flux/contracts';
import {
  DuplicateConnectionError,
  ConnectionNotFoundError,
  NotConnectedError,
  MessageDeliveryError,
} from './errors.js';
import { initAuthState, clearAuthDir } from './auth-storage.js';
import { calculateBackoff, classifyDisconnectReason } from './backoff.js';
import { JidReconciler, formatToWhatsAppJid } from './jid-reconciler.js';
import { parseBaileysMessage } from './message-parser.js';

interface ConnectionSession {
  connectionId: string;
  socket?: WASocket | any;
  status: ConnectionStatus;
  reconciler: JidReconciler;
  authDir: string;
  retryAttempt: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  options: ConnectOptions;
  isShuttingDown: boolean;
}

export class BaileysConnector extends EventEmitter implements MessagingConnector {
  private sessions = new Map<string, ConnectionSession>();

  /**
   * Connects to WhatsApp via Baileys.
   * Enforces exclusive socket ownership per connection (ADR 0010).
   */
  async connect(connectionId: string, options: ConnectOptions = {}): Promise<void> {
    const existing = this.sessions.get(connectionId);

    if (existing && existing.status !== 'disconnected' && existing.status !== 'failed') {
      if (options.replaceExisting) {
        // Gracefully terminate existing socket before replacing
        await this.disconnect(connectionId);
      } else {
        throw new DuplicateConnectionError(connectionId);
      }
    }

    const session: ConnectionSession = {
      connectionId,
      status: 'connecting',
      reconciler: new JidReconciler(),
      authDir: '',
      retryAttempt: 0,
      options,
      isShuttingDown: false,
    };

    this.sessions.set(connectionId, session);
    this.updateStatus(session, 'connecting');

    await this.spawnSocket(session);
  }

  /**
   * Spawns a new Baileys socket instance for the given session.
   */
  private async spawnSocket(session: ConnectionSession): Promise<void> {
    const { connectionId, options } = session;

    try {
      const { state, saveCreds, authDir } = await initAuthState(connectionId, {
        dataDir: options.dataDir,
        authDir: options.authDir,
        authStateFactory: options.authStateFactory,
      });

      session.authDir = authDir;

      const logger =
        (options.logger as any) ||
        (pino as any)({
          level: 'silent',
        });

      const socketFactory = options.socketFactory || makeWASocket;

      const sock = socketFactory({
        auth: state,
        printQRInTerminal: options.printQRInTerminal ?? false,
        logger,
        browser: options.browser || ['Dispar Flux', 'Chrome', '1.0.0'],
        markOnlineOnConnect: options.markOnlineOnConnect ?? true,
      } as any);

      session.socket = sock;

      // Listen to credentials updates
      if (sock.ev && typeof sock.ev.on === 'function') {
        sock.ev.on('creds.update', async () => {
          try {
            await saveCreds();
          } catch (err: unknown) {
            this.emit('error', err instanceof Error ? err : new Error(String(err)), connectionId);
          }
        });

        // Listen to connection lifecycle updates
        sock.ev.on('connection.update', async (update: any) => {
          await this.handleConnectionUpdate(session, update);
        });

        // Listen to incoming messages
        sock.ev.on('messages.upsert', (upsert: any) => {
          this.handleMessagesUpsert(session, upsert);
        });

        // Listen to contact changes for LID / JID mapping reconciliation
        sock.ev.on('contacts.upsert', (contacts: any[]) => {
          this.handleContactsUpdate(session, contacts);
        });
        sock.ev.on('contacts.update', (contacts: any[]) => {
          this.handleContactsUpdate(session, contacts);
        });
      }
    } catch (err: unknown) {
      session.status = 'failed';
      const error = err instanceof Error ? err : new Error(String(err));
      this.updateStatus(session, 'failed', error.message, error);
      this.emit('error', error, connectionId);
    }
  }

  /**
   * Handles Baileys connection.update events.
   */
  private async handleConnectionUpdate(session: ConnectionSession, update: any): Promise<void> {
    const { connectionId } = session;

    // 1. QR Code generated
    if (update.qr) {
      this.updateStatus(session, 'qr');
      this.emit('qr', { connectionId, qr: update.qr } satisfies QREventPayload);
    }

    // 2. Connection opened
    if (update.connection === 'open') {
      session.retryAttempt = 0;
      this.updateStatus(session, 'connected');
    }

    // 3. Connection closed
    if (update.connection === 'close') {
      if (session.isShuttingDown) {
        return;
      }

      const rawError = update.lastDisconnect?.error;
      const statusCode = rawError?.output?.statusCode ?? (rawError as any)?.statusCode;
      const errorCode = (rawError as any)?.code;

      const category = classifyDisconnectReason(statusCode, errorCode);

      if (category === 'logged_out' || category === 'conflict') {
        // Permanent disconnect: account logged out or device replaced
        this.updateStatus(session, 'disconnected', 'loggedOut');
        if (session.authDir) {
          try {
            await clearAuthDir(session.authDir);
          } catch {
            // Ignore cleanup errors on logout
          }
        }
        this.sessions.delete(connectionId);
        return;
      }

      if (category === 'restart_required') {
        // Immediate restart required by Baileys stream
        this.updateStatus(session, 'connecting', 'restartRequired');
        await this.spawnSocket(session);
        return;
      }

      // Temporary network error: apply exponential backoff
      const maxRetries = session.options.maxRetries ?? 5;
      if (session.retryAttempt < maxRetries) {
        const delay = calculateBackoff(session.retryAttempt, {
          initialDelayMs: session.options.initialRetryDelayMs,
          maxDelayMs: session.options.maxRetryDelayMs,
        });
        session.retryAttempt += 1;

        this.updateStatus(session, 'connecting', `reconnecting_attempt_${session.retryAttempt}`);

        session.reconnectTimer = setTimeout(() => {
          if (!session.isShuttingDown) {
            this.spawnSocket(session).catch((err) => {
              this.emit('error', err, connectionId);
            });
          }
        }, delay);
      } else {
        // Retries exhausted
        this.updateStatus(session, 'failed', 'maxRetriesExceeded', rawError);
      }
    }
  }

  /**
   * Handles incoming Baileys messages.
   */
  private handleMessagesUpsert(session: ConnectionSession, upsert: any): void {
    if (!upsert || !Array.isArray(upsert.messages)) return;

    for (const rawMsg of upsert.messages) {
      const parsed = parseBaileysMessage(rawMsg, session.connectionId, session.reconciler);
      if (parsed) {
        this.emit('message', parsed);
      }
    }
  }

  /**
   * Reconciles contacts to link LIDs and JIDs.
   */
  private handleContactsUpdate(session: ConnectionSession, contacts: any[]): void {
    if (!Array.isArray(contacts)) return;
    for (const contact of contacts) {
      if (contact && contact.id && contact.lid) {
        session.reconciler.registerMapping(contact.lid, contact.id);
      }
    }
  }

  /**
   * Updates session status and emits structured status event.
   */
  private updateStatus(
    session: ConnectionSession,
    status: ConnectionStatus,
    disconnectReason?: string,
    error?: Error
  ): void {
    session.status = status;
    const payload: StatusEventPayload = {
      connectionId: session.connectionId,
      status,
      disconnectReason,
      error,
    };
    this.emit('status', payload);
  }

  /**
   * Disconnects an active connection.
   */
  async disconnect(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (!session) {
      return;
    }

    session.isShuttingDown = true;
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = undefined;
    }

    if (session.socket) {
      try {
        if (typeof session.socket.end === 'function') {
          session.socket.end(undefined);
        } else if (session.socket.ws && typeof session.socket.ws.close === 'function') {
          session.socket.ws.close();
        }
      } catch {
        // Socket may already be closed
      }
    }

    this.updateStatus(session, 'disconnected', 'manualDisconnect');
    this.sessions.delete(connectionId);
  }

  /**
   * Sends an outbound message (text or media) via the active Baileys socket.
   */
  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    const session = this.sessions.get(params.connectionId);
    if (!session) {
      throw new ConnectionNotFoundError(params.connectionId);
    }

    if (session.status !== 'connected' || !session.socket) {
      throw new NotConnectedError(params.connectionId, session.status);
    }

    const targetJid = formatToWhatsAppJid(params.to);

    let messagePayload: AnyMessageContent;

    if (params.mediaUrl || params.mediaBuffer) {
      const mediaSource = params.mediaBuffer
        ? (Buffer.isBuffer(params.mediaBuffer) ? params.mediaBuffer : Buffer.from(params.mediaBuffer))
        : { url: params.mediaUrl! };

      const type = params.type || 'document';

      if (type === 'image') {
        messagePayload = {
          image: mediaSource,
          caption: params.content || params.caption,
          mimetype: params.mediaType || 'image/jpeg',
        };
      } else if (type === 'video') {
        messagePayload = {
          video: mediaSource,
          caption: params.content || params.caption,
          mimetype: params.mediaType || 'video/mp4',
        };
      } else if (type === 'audio') {
        messagePayload = {
          audio: mediaSource,
          mimetype: params.mediaType || 'audio/ogg; codecs=opus',
          ptt: true,
        };
      } else {
        messagePayload = {
          document: mediaSource,
          mimetype: params.mediaType || 'application/octet-stream',
          fileName: params.fileName || 'file',
          caption: params.content || params.caption,
        };
      }
    } else {
      messagePayload = {
        text: params.content,
      };
    }

    try {
      const sendResponse = await session.socket.sendMessage(targetJid, messagePayload, {
        quoted: params.quotedMessageId
          ? {
              key: {
                id: params.quotedMessageId,
                remoteJid: targetJid,
              },
              message: { conversation: '' },
            }
          : undefined,
      });

      const messageId = sendResponse?.key?.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      return {
        messageId,
        connectionId: params.connectionId,
        to: params.to,
        status: 'sent',
        timestamp: new Date(),
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new MessageDeliveryError(`Failed to send message to '${params.to}': ${error.message}`, error);
    }
  }

  /**
   * Retrieves the current connection status.
   */
  getStatus(connectionId: string): ConnectionStatus {
    const session = this.sessions.get(connectionId);
    return session ? session.status : 'disconnected';
  }

  // Strongly typed event listener overloads
  override on(event: 'qr', listener: (payload: QREventPayload) => void): this;
  override on(event: 'status', listener: (payload: StatusEventPayload) => void): this;
  override on(event: 'message', listener: (message: InboundMessage) => void): this;
  override on(event: 'error', listener: (error: Error, connectionId?: string) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
