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
  HistorySyncPayload,
  MessageStatusUpdatePayload,
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
        browser: options.browser || ['Mac OS', 'Desktop', '14.4.1'],
        syncFullHistory: true,
        shouldSyncHistoryMessage: () => true,
        markOnlineOnConnect: options.markOnlineOnConnect ?? false,
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 90_000,
        getMessage: async () => undefined,
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

        // Listen to message status updates (delivery / read receipts)
        sock.ev.on('messages.update', (updates: any[]) => {
          this.handleMessagesUpdate(session, updates);
        });

        // Listen to messaging history sync
        sock.ev.on('messaging-history.set', (payload: any) => {
          this.handleMessagingHistorySet(session, payload);
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
   * Handles messaging-history.set event from Baileys.
   */
  private handleMessagingHistorySet(session: ConnectionSession, payload: any): void {
    if (!payload) return;

    // 1. Ingest lidPnMappings first so messages addressed to LID can be resolved
    if (Array.isArray(payload.lidPnMappings)) {
      for (const map of payload.lidPnMappings) {
        if (map?.lid && map?.pn) {
          session.reconciler.registerMapping(map.lid, map.pn);
        }
      }
    }

    // 2. Ingest contacts
    if (Array.isArray(payload.contacts)) {
      this.handleContactsUpdate(session, payload.contacts);
    }

    // 3. Parse messages
    const parsedMessages: InboundMessage[] = [];
    if (Array.isArray(payload.messages)) {
      for (const rawMsg of payload.messages) {
        const parsed = parseBaileysMessage(rawMsg, session.connectionId, session.reconciler);
        if (parsed) {
          parsedMessages.push(parsed);
        }
      }
    }

    // 4. Map chats
    const chats = Array.isArray(payload.chats)
      ? payload.chats.map((c: any) => ({
          id: c.id,
          name: c.name || undefined,
          conversationTimestamp:
            typeof c.conversationTimestamp === 'object' && c.conversationTimestamp?.low
              ? c.conversationTimestamp.low
              : Number(c.conversationTimestamp) || undefined,
          unreadCount: Number(c.unreadCount) || 0,
        }))
      : [];

    const contacts = Array.isArray(payload.contacts)
      ? payload.contacts.map((c: any) => ({
          id: c.id,
          name: c.name || undefined,
          notify: c.notify || undefined,
          phoneNumber: c.phoneNumber || undefined,
          lid: c.lid || undefined,
        }))
      : [];

    const historyPayload: HistorySyncPayload = {
      connectionId: session.connectionId,
      chats,
      contacts,
      messages: parsedMessages,
      lidPnMappings: Array.isArray(payload.lidPnMappings) ? payload.lidPnMappings : [],
      isLatest: Boolean(payload.isLatest),
      progress: payload.progress ?? null,
      syncType: payload.syncType ?? null,
    };

    this.emit('history', historyPayload);
  }

  /**
   * Handles messages.update events (delivery and read status receipts).
   */
  private handleMessagesUpdate(session: ConnectionSession, updates: any[]): void {
    if (!Array.isArray(updates)) return;

    for (const item of updates) {
      if (!item?.key?.id) continue;
      const statusCode = item.update?.status;
      let status: 'pending' | 'sent' | 'delivered' | 'read' = 'sent';
      if (statusCode === 2) status = 'sent';
      else if (statusCode === 3) status = 'delivered';
      else if (statusCode === 4 || statusCode === 5) status = 'read';

      this.emit('message:status', {
        connectionId: session.connectionId,
        messageId: item.key.id,
        remoteJid: item.key.remoteJid || '',
        status,
      });
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
   * Disconnects all active sessions.
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.disconnect(id);
    }
  }

  /**
   * Sends an outbound message (text or media) via the active Baileys socket.
   */
  async sendMessage(params: SendMessageParams): Promise<SendResult>;
  async sendMessage(
    connectionId: string,
    options: { to: string; content: string | { text: string }; [key: string]: any }
  ): Promise<SendResult>;
  async sendMessage(
    paramsOrConnId: SendMessageParams | string,
    maybeOptions?: any
  ): Promise<SendResult> {
    let params: SendMessageParams;
    if (typeof paramsOrConnId === 'string') {
      const c = maybeOptions?.content;
      const textContent =
        typeof c === 'object' && c && 'text' in c
          ? c.text
          : typeof c === 'string'
            ? c
            : '';
      params = {
        connectionId: paramsOrConnId,
        to: maybeOptions?.to || '',
        content: textContent,
        ...maybeOptions,
      };
      if (typeof maybeOptions?.content === 'object' && maybeOptions?.content && 'text' in maybeOptions.content) {
        params.content = maybeOptions.content.text;
      }
    } else {
      let content = paramsOrConnId.content;
      if (typeof content === 'object' && content && 'text' in (content as any)) {
        content = (content as any).text;
      }
      params = { ...paramsOrConnId, content };
    }

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
   * Returns authenticated user session data if connected.
   */
  getSessionUser(connectionId: string): { id: string; name?: string } | undefined {
    const session = this.sessions.get(connectionId);
    return session?.socket?.user;
  }

  /**
   * Retrieves the current connection status.
   */
  getStatus(connectionId: string): ConnectionStatus {
    const session = this.sessions.get(connectionId);
    return session ? session.status : 'disconnected';
  }

  /**
   * Checks whether the given phone numbers or JIDs exist on WhatsApp.
   */
  async onWhatsApp(
    connectionId: string,
    ...phoneNumbers: string[]
  ): Promise<Array<{ jid: string; exists: boolean }>> {
    const session = this.sessions.get(connectionId);
    if (!session || session.status !== 'connected' || !session.socket) {
      throw new NotConnectedError(connectionId, session ? session.status : 'disconnected');
    }

    if (phoneNumbers.length === 0) {
      return [];
    }

    if (typeof session.socket.onWhatsApp !== 'function') {
      return phoneNumbers.map((p) => ({
        jid: formatToWhatsAppJid(p),
        exists: true,
      }));
    }

    try {
      const results = await session.socket.onWhatsApp(...phoneNumbers);
      if (!Array.isArray(results)) {
        return [];
      }
      return results.map((r: any) => ({
        jid: r.jid,
        exists: Boolean(r.exists),
      }));
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new Error(`Failed to check numbers on WhatsApp: ${error.message}`);
    }
  }

  /**
   * Fetches older messages from WhatsApp using sock.fetchMessageHistory anchored at oldest message.
   */
  async fetchOlderMessages(
    connectionId: string,
    jid: string,
    count = 50,
    oldestKey: { id: string; fromMe: boolean; timestampMs: number }
  ): Promise<{ requestId: string | null; count: number }> {
    const session = this.sessions.get(connectionId);
    if (!session) {
      throw new ConnectionNotFoundError(connectionId);
    }
    if (session.status !== 'connected' || !session.socket) {
      throw new NotConnectedError(connectionId, session ? session.status : 'disconnected');
    }
    if (typeof session.socket.fetchMessageHistory !== 'function') {
      return { requestId: null, count: 0 };
    }
    // CRITICAL: timestamp must be in milliseconds to avoid WhatsApp 1970 bug!
    const tsMs = oldestKey.timestampMs > 1e11 ? oldestKey.timestampMs : oldestKey.timestampMs * 1000;
    const targetJid = formatToWhatsAppJid(jid);
    try {
      const requestId = await session.socket.fetchMessageHistory(
        count,
        { id: oldestKey.id, remoteJid: targetJid, fromMe: oldestKey.fromMe },
        tsMs
      );
      return { requestId: requestId || null, count };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new MessageDeliveryError(`Failed to fetch history for '${jid}': ${error.message}`, error);
    }
  }

  // Strongly typed event listener overloads
  override on(event: 'qr', listener: (payload: QREventPayload) => void): this;
  override on(event: 'status', listener: (payload: StatusEventPayload) => void): this;
  override on(event: 'message', listener: (message: InboundMessage) => void): this;
  override on(event: 'history', listener: (payload: HistorySyncPayload) => void): this;
  override on(event: 'message:status', listener: (payload: MessageStatusUpdatePayload) => void): this;
  override on(event: 'error', listener: (error: Error, connectionId?: string) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
