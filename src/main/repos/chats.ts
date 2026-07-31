import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { chats, messages } from '../db/schema'
import { avatarUrl, mediaUrl } from '../core/whatsapp/mediaStore'
import type {
  Chat,
  MediaKind,
  MediaState,
  Message,
  MessageDirection,
  MessageStatus
} from '@shared/types'

type ChatRow = typeof chats.$inferSelect
type MessageRow = typeof messages.$inferSelect

/**
 * As linhas do banco NAO vao cruas para o renderer.
 *
 * Duas razoes: `raw_json` guarda a mensagem original do Baileys, que inclui as
 * chaves de descriptografia da midia (nao tem por que sair do processo main), e
 * `media_path` e um caminho absoluto de disco, que o renderer nao consegue usar
 * — ele precisa da URL `disparmedia://`. Entao todo retorno passa por aqui.
 */
function toChat(row: ChatRow): Chat {
  return {
    jid: row.jid,
    name: row.name,
    lastMessage: row.lastMessage,
    lastTs: row.lastTs,
    unread: row.unread,
    avatarUrl: avatarUrl(row.avatarPath, row.avatarTs)
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatJid: row.chatJid,
    direction: row.direction as MessageDirection,
    body: row.body,
    ts: row.ts,
    waMessageId: row.waMessageId,
    status: row.status as MessageStatus | null,
    mediaKind: row.mediaKind as MediaKind | null,
    mediaState: row.mediaState as MediaState | null,
    mediaUrl: mediaUrl(row.mediaPath),
    mediaMime: row.mediaMime,
    mediaName: row.mediaName,
    mediaSize: row.mediaSize,
    mediaSeconds: row.mediaSeconds,
    mediaPtt: row.mediaPtt === 1
  }
}

/* ── Conversas ───────────────────────────────────────────────────────────── */

export function upsertChat(
  jid: string,
  patch: { name?: string | null; lastMessage?: string | null; lastTs?: number }
): void {
  const existing = getDb().select().from(chats).where(eq(chats.jid, jid)).get()
  if (existing) {
    getDb()
      .update(chats)
      .set({
        // Nao apaga um nome ja conhecido com null.
        name: patch.name ?? existing.name,
        lastMessage: patch.lastMessage ?? existing.lastMessage,
        // Historico antigo chegando depois nao pode puxar a conversa para o
        // topo da lista: so avanca o carimbo, nunca retrocede.
        lastTs: Math.max(patch.lastTs ?? 0, existing.lastTs ?? 0) || null
      })
      .where(eq(chats.jid, jid))
      .run()
  } else {
    getDb()
      .insert(chats)
      .values({
        jid,
        name: patch.name ?? null,
        lastMessage: patch.lastMessage ?? null,
        lastTs: patch.lastTs ?? Date.now(),
        unread: 0
      })
      .run()
  }
  scheduleSave()
}

export function getChat(jid: string): ChatRow | undefined {
  return getDb().select().from(chats).where(eq(chats.jid, jid)).get()
}

export function setAvatar(jid: string, path: string | null): void {
  getDb()
    .update(chats)
    .set({ avatarPath: path, avatarTs: Date.now() })
    .where(eq(chats.jid, jid))
    .run()
  scheduleSave()
}

/**
 * Conversas cuja foto de perfil nunca foi buscada ou ja passou do TTL.
 *
 * Buscar foto custa uma ida a rede por contato, entao nunca fazemos isso no
 * caminho de renderizar a lista — e um trabalho de fundo, com validade.
 */
export function chatsNeedingAvatar(ttlMs: number, limit = 30): string[] {
  const cutoff = Date.now() - ttlMs
  return getDb()
    .select({ jid: chats.jid })
    .from(chats)
    .where(or(isNull(chats.avatarTs), lt(chats.avatarTs, cutoff)))
    .orderBy(desc(chats.lastTs))
    .limit(limit)
    .all()
    .map((r) => r.jid)
}

export function incrementUnread(jid: string): void {
  getDb()
    .update(chats)
    .set({ unread: sql`${chats.unread} + 1` })
    .where(eq(chats.jid, jid))
    .run()
  scheduleSave()
}

export function markRead(jid: string): void {
  getDb().update(chats).set({ unread: 0 }).where(eq(chats.jid, jid)).run()
  scheduleSave()
}

export function listChats(limit = 200): Chat[] {
  return getDb().select().from(chats).orderBy(desc(chats.lastTs)).limit(limit).all().map(toChat)
}

export function totalUnread(): number {
  return (
    getDb()
      .select({ n: sql<number>`coalesce(sum(unread), 0)` })
      .from(chats)
      .get()?.n ?? 0
  )
}

/* ── Mensagens ───────────────────────────────────────────────────────────── */

export interface InsertMessageInput {
  id: string
  chatJid: string
  direction: MessageDirection
  body: string | null
  ts: number
  waMessageId: string | null
  status?: MessageStatus | null
  mediaKind?: MediaKind | null
  mediaPath?: string | null
  mediaMime?: string | null
  mediaName?: string | null
  mediaSize?: number | null
  mediaSeconds?: number | null
  mediaPtt?: boolean
  mediaState?: MediaState | null
  rawProto?: string | null
}

/** true se a mensagem foi inserida; false se ja existia (idempotencia). */
export function insertMessage(m: InsertMessageInput): boolean {
  const exists = getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.id, m.id))
    .get()
  if (exists) return false

  getDb()
    .insert(messages)
    .values({
      id: m.id,
      chatJid: m.chatJid,
      direction: m.direction,
      body: m.body,
      ts: m.ts,
      waMessageId: m.waMessageId,
      status: m.status ?? null,
      mediaKind: m.mediaKind ?? null,
      mediaPath: m.mediaPath ?? null,
      mediaMime: m.mediaMime ?? null,
      mediaName: m.mediaName ?? null,
      mediaSize: m.mediaSize ?? null,
      mediaSeconds: m.mediaSeconds ?? null,
      mediaPtt: m.mediaPtt ? 1 : 0,
      mediaState: m.mediaState ?? null,
      rawProto: m.rawProto ?? null
    })
    .run()
  scheduleSave()
  return true
}

export function getMessageRow(id: string): MessageRow | undefined {
  return getDb().select().from(messages).where(eq(messages.id, id)).get()
}

export function getMessage(id: string): Message | null {
  const row = getMessageRow(id)
  return row ? toMessage(row) : null
}

export function setMediaState(
  id: string,
  state: MediaState,
  patch?: { path?: string | null; mime?: string | null; size?: number | null }
): void {
  getDb()
    .update(messages)
    .set({
      mediaState: state,
      ...(patch?.path !== undefined ? { mediaPath: patch.path } : {}),
      ...(patch?.mime !== undefined ? { mediaMime: patch.mime } : {}),
      ...(patch?.size !== undefined ? { mediaSize: patch.size } : {})
    })
    .where(eq(messages.id, id))
    .run()
  scheduleSave()
}

/**
 * Atualiza o status de entrega vindo do evento `messages.update`.
 *
 * So avanca: o WhatsApp reemite acks fora de ordem depois de uma reconexao, e
 * sem isso uma mensagem ja lida voltaria para "enviada" na tela.
 */
const STATUS_RANK: Record<MessageStatus, number> = {
  error: 0,
  pending: 1,
  sent: 2,
  delivered: 3,
  read: 4
}

export function advanceMessageStatus(id: string, status: MessageStatus): boolean {
  const row = getMessageRow(id)
  if (!row) return false
  const current = row.status as MessageStatus | null
  if (current && STATUS_RANK[current] >= STATUS_RANK[status] && status !== 'error') return false

  getDb().update(messages).set({ status }).where(eq(messages.id, id)).run()
  scheduleSave()
  return true
}

export function listMessages(chatJid: string, limit = 200): Message[] {
  // Pega as ultimas N em ordem decrescente e devolve em ordem cronologica.
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.chatJid, chatJid))
    .orderBy(desc(messages.ts))
    .limit(limit)
    .all()
    .reverse()
    .map(toMessage)
}

/** Mensagens recebidas ainda nao marcadas como lidas no WhatsApp. */
export function unreadIncomingIds(chatJid: string, limit = 50): string[] {
  return getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.chatJid, chatJid),
        eq(messages.direction, 'in'),
        or(isNull(messages.status), eq(messages.status, 'delivered'))
      )
    )
    .orderBy(desc(messages.ts))
    .limit(limit)
    .all()
    .map((r) => r.id)
}
