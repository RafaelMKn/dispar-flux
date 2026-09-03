import type { InboundMessage } from '@dispar-flux/contracts';
import { JidReconciler } from './jid-reconciler.js';

export interface ExtractedContent {
  text: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'other';
  mediaUrl?: string;
  mediaType?: string;
  fileName?: string;
}

/**
 * Recursively unwraps wrapped message envelopes (view-once, ephemeral, forwarded, etc.)
 */
export function unwrapMessage(message: any): any {
  if (!message || typeof message !== 'object') return null;

  if (message.ephemeralMessage?.message) {
    return unwrapMessage(message.ephemeralMessage.message);
  }
  if (message.viewOnceMessage?.message) {
    return unwrapMessage(message.viewOnceMessage.message);
  }
  if (message.viewOnceMessageV2?.message) {
    return unwrapMessage(message.viewOnceMessageV2.message);
  }
  if (message.viewOnceMessageV2Extension?.message) {
    return unwrapMessage(message.viewOnceMessageV2Extension.message);
  }
  if (message.documentWithCaptionMessage?.message) {
    return unwrapMessage(message.documentWithCaptionMessage.message);
  }
  if (message.editedMessage?.message?.protocolMessage?.editedMessage) {
    return unwrapMessage(message.editedMessage.message.protocolMessage.editedMessage);
  }

  return message;
}

/**
 * Extracts normalized text content and media metadata from raw Baileys message object.
 */
export function extractContent(rawMessage: any): ExtractedContent {
  const msg = unwrapMessage(rawMessage);
  if (!msg) {
    return { text: '', type: 'other' };
  }

  // 1. Plain text conversation
  if (typeof msg.conversation === 'string') {
    return { text: msg.conversation, type: 'text' };
  }

  // 2. Extended text message
  if (msg.extendedTextMessage?.text) {
    return { text: msg.extendedTextMessage.text, type: 'text' };
  }

  // 3. Image message
  if (msg.imageMessage) {
    return {
      text: msg.imageMessage.caption || '',
      type: 'image',
      mediaUrl: msg.imageMessage.url || undefined,
      mediaType: msg.imageMessage.mimetype || 'image/jpeg',
    };
  }

  // 4. Video message
  if (msg.videoMessage) {
    return {
      text: msg.videoMessage.caption || '',
      type: 'video',
      mediaUrl: msg.videoMessage.url || undefined,
      mediaType: msg.videoMessage.mimetype || 'video/mp4',
    };
  }

  // 5. Audio / Voice message (PTT)
  if (msg.audioMessage) {
    return {
      text: '',
      type: 'audio',
      mediaUrl: msg.audioMessage.url || undefined,
      mediaType: msg.audioMessage.mimetype || 'audio/ogg',
    };
  }

  // 6. Document message
  if (msg.documentMessage) {
    return {
      text: msg.documentMessage.caption || '',
      type: 'document',
      mediaUrl: msg.documentMessage.url || undefined,
      mediaType: msg.documentMessage.mimetype || 'application/octet-stream',
      fileName: msg.documentMessage.fileName || undefined,
    };
  }

  // 7. Other (e.g. sticker, location, contact card)
  if (msg.stickerMessage) {
    return {
      text: '',
      type: 'other',
      mediaType: msg.stickerMessage.mimetype || 'image/webp',
    };
  }

  return { text: '', type: 'other' };
}

/**
 * Normalizes messageTimestamp into a standard Date object.
 */
export function parseTimestamp(ts: unknown): Date {
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') {
    // If Unix timestamp in seconds, convert to ms
    const ms = ts > 1e11 ? ts : ts * 1000;
    return new Date(ms);
  }
  if (typeof ts === 'string') {
    const num = Number(ts);
    if (!isNaN(num)) return parseTimestamp(num);
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  if (ts && typeof ts === 'object' && 'low' in ts) {
    const low = (ts as { low: number }).low;
    const ms = low > 1e11 ? low : low * 1000;
    return new Date(ms);
  }
  return new Date();
}

/**
 * Parses raw Baileys WAMessage into a standardized InboundMessage contract.
 */
export function parseBaileysMessage(
  baileysMsg: any,
  connectionId: string,
  reconciler?: JidReconciler
): InboundMessage | null {
  if (!baileysMsg || !baileysMsg.key) {
    return null;
  }

  const { key, message, messageTimestamp } = baileysMsg;

  // Ignore outbound messages when processing inbound events
  if (key.fromMe) {
    return null;
  }

  const remoteJid = key.remoteJid || '';
  const participant = key.participant;

  const activeReconciler = reconciler || new JidReconciler();
  const identity = activeReconciler.reconcile(remoteJid, participant);

  const extracted = extractContent(message);
  const timestamp = parseTimestamp(messageTimestamp);

  return {
    messageId: key.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    connectionId,
    from: identity.phoneNumber || identity.canonicalJid,
    remoteJid,
    participant: participant || undefined,
    content: extracted.text,
    type: extracted.type,
    mediaUrl: extracted.mediaUrl,
    mediaType: extracted.mediaType,
    fileName: extracted.fileName,
    timestamp,
    isLid: identity.isLid,
    raw: baileysMsg,
  };
}
