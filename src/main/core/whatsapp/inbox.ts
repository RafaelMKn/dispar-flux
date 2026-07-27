import { EventEmitter } from 'node:events'
import { upsertChat, incrementUnread, insertMessage } from '../../repos/chats'
import { addOptOut } from '../../repos/optOuts'
import { isOptOutRequest, jidToE164 } from './optOutDetect'
import { scoped } from '../../logger'
import { saveNow } from '../../db'
import type { MessageDirection } from '@shared/types'

const log = scoped('inbox')

/** Emite 'changed' com { chatJid, optOut? } para o IPC repassar ao renderer. */
export const inboxEvents = new EventEmitter()

/** JIDs que nao sao conversa de pessoa e nao devem virar item da inbox. */
function isIgnorableJid(jid: string | null | undefined): boolean {
  if (!jid) return true
  return (
    jid === 'status@broadcast' ||
    jid.endsWith('@newsletter') ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@g.us') // grupos: ruido para uma ferramenta de prospeccao
  )
}

/**
 * Extrai o texto de uma mensagem do WhatsApp.
 *
 * Mensagens de midia nao tem texto proprio (so legenda). Na Fase 2 tratamos
 * apenas texto; midia entra como um marcador para o usuario saber que chegou
 * algo, em vez de a conversa parecer vazia.
 */
function extractText(message: Record<string, unknown> | null | undefined): string | null {
  if (!message) return null
  const m = message as {
    conversation?: string
    extendedTextMessage?: { text?: string }
    imageMessage?: { caption?: string }
    videoMessage?: { caption?: string }
    documentMessage?: { caption?: string; fileName?: string }
    audioMessage?: unknown
    stickerMessage?: unknown
    ephemeralMessage?: { message?: Record<string, unknown> }
    viewOnceMessage?: { message?: Record<string, unknown> }
  }

  if (m.ephemeralMessage?.message) return extractText(m.ephemeralMessage.message)
  if (m.viewOnceMessage?.message) return extractText(m.viewOnceMessage.message)

  if (typeof m.conversation === 'string') return m.conversation
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text
  if (m.imageMessage) return m.imageMessage.caption || '[imagem]'
  if (m.videoMessage) return m.videoMessage.caption || '[video]'
  if (m.documentMessage)
    return m.documentMessage.caption || `[documento: ${m.documentMessage.fileName ?? 'arquivo'}]`
  if (m.audioMessage) return '[audio]'
  if (m.stickerMessage) return '[sticker]'
  return null
}

interface WaMessageLike {
  key?: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null }
  message?: Record<string, unknown> | null
  pushName?: string | null
  messageTimestamp?: number | Long | null
}

interface Long {
  toNumber: () => number
}

function toMillis(ts: WaMessageLike['messageTimestamp']): number {
  if (ts == null) return Date.now()
  const n = typeof ts === 'number' ? ts : ts.toNumber()
  // O WhatsApp manda em segundos.
  return n < 1e12 ? n * 1000 : n
}

/**
 * Processa mensagens vindas do evento `messages.upsert`.
 *
 * Idempotente: usa o id da mensagem como chave primaria, entao reemissao pelo
 * Baileys (comum apos reconexao) nao duplica nada.
 */
export function handleUpsert(msgs: WaMessageLike[]): void {
  for (const msg of msgs) {
    const jid = msg.key?.remoteJid
    if (isIgnorableJid(jid)) continue

    const id = msg.key?.id
    if (!id || !jid) continue

    const body = extractText(msg.message)
    // Sem texto e sem marcador (ex.: reacoes, protocolos) — nao vira mensagem.
    if (body === null) continue

    const direction: MessageDirection = msg.key?.fromMe ? 'out' : 'in'
    const ts = toMillis(msg.messageTimestamp)

    const inserted = insertMessage({
      id,
      chatJid: jid,
      direction,
      body,
      ts,
      waMessageId: id
    })
    if (!inserted) continue

    upsertChat(jid, {
      name: direction === 'in' ? (msg.pushName ?? null) : null,
      lastMessage: body,
      lastTs: ts
    })

    let optOut = false
    if (direction === 'in') {
      incrementUnread(jid)

      // Descadastro pedido pelo contato: respeitar e obrigacao (LGPD) e reduz
      // muito o risco de denuncia. Grava no opt-out GLOBAL, valendo para todas
      // as bases.
      if (isOptOutRequest(body)) {
        const phone = jidToE164(jid)
        if (phone) {
          addOptOut(phone, 'respondeu pedido de descadastro')
          saveNow() // decisao de conformidade: nao pode se perder num crash
          optOut = true
          log.warn('opt-out registrado por mensagem do contato', { jid, phone, body })
        }
      }
    }

    inboxEvents.emit('changed', { chatJid: jid, optOut })
  }
}
