import { desc, eq, sql } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { chats, messages } from '../db/schema'
import type { Chat, Message, MessageDirection } from '@shared/types'

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
        lastTs: patch.lastTs ?? existing.lastTs
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
  return getDb().select().from(chats).orderBy(desc(chats.lastTs)).limit(limit).all()
}

/** true se a mensagem foi inserida; false se ja existia (idempotencia). */
export function insertMessage(m: {
  id: string
  chatJid: string
  direction: MessageDirection
  body: string | null
  ts: number
  waMessageId: string | null
  status?: string | null
}): boolean {
  const exists = getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.id, m.id))
    .get()
  if (exists) return false
  getDb()
    .insert(messages)
    .values({ ...m, status: m.status ?? null })
    .run()
  scheduleSave()
  return true
}

export function listMessages(chatJid: string, limit = 200): Message[] {
  // Pega as ultimas N em ordem decrescente e devolve em ordem cronologica.
  const rows = getDb()
    .select()
    .from(messages)
    .where(eq(messages.chatJid, chatJid))
    .orderBy(desc(messages.ts))
    .limit(limit)
    .all()
  return rows.reverse() as Message[]
}

export function totalUnread(): number {
  return (
    getDb()
      .select({ n: sql<number>`coalesce(sum(unread), 0)` })
      .from(chats)
      .get()?.n ?? 0
  )
}
