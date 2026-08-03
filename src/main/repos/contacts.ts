import { randomUUID } from 'node:crypto'
import { and, eq, isNull, isNotNull, like, or, sql, inArray } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { contacts } from '../db/schema'
import { getOptOutSet } from './optOuts'
import type { Contact, ContactFilter, ContactListStats } from '@shared/types'

export interface NewContact {
  listId: string
  name: string | null
  phoneE164: string
  extraJson: string | null
}

export function insertContacts(rows: NewContact[]): number {
  if (rows.length === 0) return 0
  const now = Date.now()
  const values = rows.map((r) => ({
    id: randomUUID(),
    listId: r.listId,
    name: r.name,
    phoneE164: r.phoneE164,
    jid: null,
    extraJson: r.extraJson,
    waValid: null,
    optOut: 0,
    createdAt: now
  }))
  // Insere em lotes: o sql.js monta a query inteira em memoria.
  const CHUNK = 400
  for (let i = 0; i < values.length; i += CHUNK) {
    getDb()
      .insert(contacts)
      .values(values.slice(i, i + CHUNK))
      .run()
  }
  scheduleSave()
  return values.length
}

/** Telefones que ja existem na base (para nao duplicar no import). */
export function existingPhones(listId: string): Set<string> {
  const rows = getDb()
    .select({ phone: contacts.phoneE164 })
    .from(contacts)
    .where(eq(contacts.listId, listId))
    .all()
  return new Set(rows.map((r) => r.phone))
}

function filterCondition(listId: string, filter: ContactFilter) {
  const base = eq(contacts.listId, listId)
  switch (filter) {
    case 'valid':
      return and(base, eq(contacts.waValid, 1))
    case 'invalid':
      return and(base, eq(contacts.waValid, 0))
    case 'unchecked':
      return and(base, isNull(contacts.waValid))
    case 'optOut':
      return and(base, eq(contacts.optOut, 1))
    default:
      return base
  }
}

export function pageContacts(
  listId: string,
  opts: { search?: string; filter?: ContactFilter; offset?: number; limit?: number } = {}
): { rows: Contact[]; total: number } {
  const { search, filter = 'all', offset = 0, limit = 50 } = opts
  let cond = filterCondition(listId, filter)

  if (search?.trim()) {
    const term = `%${search.trim()}%`
    cond = and(cond, or(like(contacts.name, term), like(contacts.phoneE164, term)))!
  }

  const total =
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(contacts)
      .where(cond)
      .get()?.n ?? 0

  const rows = getDb().select().from(contacts).where(cond).limit(limit).offset(offset).all()

  return { rows, total }
}

/**
 * Uniao das chaves de `extra_json` da base inteira.
 *
 * Precisa varrer todos os contatos (nao so a pagina) para as colunas ficarem
 * estaveis ao paginar — senao a tabela mudaria de formato a cada pagina.
 */
export function extraKeys(listId: string): string[] {
  const rows = getDb()
    .select({ extraJson: contacts.extraJson })
    .from(contacts)
    .where(and(eq(contacts.listId, listId), isNotNull(contacts.extraJson)))
    .all()

  const keys = new Set<string>()
  for (const r of rows) {
    if (!r.extraJson) continue
    try {
      for (const k of Object.keys(JSON.parse(r.extraJson) as Record<string, unknown>)) keys.add(k)
    } catch {
      // linha com json invalido nao deve derrubar a listagem
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export function listStats(listId: string): ContactListStats {
  const row = getDb()
    .select({
      total: sql<number>`count(*)`,
      valid: sql<number>`sum(case when wa_valid = 1 then 1 else 0 end)`,
      invalid: sql<number>`sum(case when wa_valid = 0 then 1 else 0 end)`,
      unchecked: sql<number>`sum(case when wa_valid is null then 1 else 0 end)`,
      optOut: sql<number>`sum(case when opt_out = 1 then 1 else 0 end)`
    })
    .from(contacts)
    .where(eq(contacts.listId, listId))
    .get()

  return {
    total: row?.total ?? 0,
    valid: row?.valid ?? 0,
    invalid: row?.invalid ?? 0,
    unchecked: row?.unchecked ?? 0,
    optOut: row?.optOut ?? 0
  }
}

/** Contatos ainda sem verificacao no WhatsApp. */
export function uncheckedContacts(listId: string): Contact[] {
  return getDb()
    .select()
    .from(contacts)
    .where(and(eq(contacts.listId, listId), isNull(contacts.waValid)))
    .all()
}

export function setWaResult(id: string, exists: boolean, jid: string | null): void {
  getDb()
    .update(contacts)
    .set({ waValid: exists ? 1 : 0, jid })
    .where(eq(contacts.id, id))
    .run()
  scheduleSave()
}

export function setOptOut(id: string, optOut: boolean): void {
  getDb()
    .update(contacts)
    .set({ optOut: optOut ? 1 : 0 })
    .where(eq(contacts.id, id))
    .run()
  scheduleSave()
}

export function getContact(id: string): Contact | undefined {
  return getDb().select().from(contacts).where(eq(contacts.id, id)).get()
}

export function removeContact(id: string): void {
  getDb().delete(contacts).where(eq(contacts.id, id)).run()
  scheduleSave()
}

/** Contatos por id, na ordem em que os ids foram pedidos. */
export function getContactsByIds(ids: string[]): Contact[] {
  if (ids.length === 0) return []
  const rows: Contact[] = []
  // Em lotes: o sql.js monta a query inteira em memoria e uma base grande
  // estouraria o limite de parametros do SQLite.
  const CHUNK = 400
  for (let i = 0; i < ids.length; i += CHUNK) {
    rows.push(
      ...getDb()
        .select()
        .from(contacts)
        .where(inArray(contacts.id, ids.slice(i, i + CHUNK)))
        .all()
    )
  }
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((c): c is Contact => c !== undefined)
}

/**
 * O contato com este telefone em QUALQUER base.
 *
 * E o que responde "essa pessoa esta em alguma base de disparo?" quando chega
 * uma mensagem — a pergunta que decide se ela entra no CRM ou e ignorada. Se o
 * numero estiver em mais de uma base, devolve a linha que ja tem jid conhecido:
 * e a que foi validada no WhatsApp.
 */
export function findContactByPhone(phoneE164: string): Contact | undefined {
  const rows = getDb().select().from(contacts).where(eq(contacts.phoneE164, phoneE164)).all()
  return rows.find((r) => r.jid) ?? rows[0]
}

/** O contato dono deste JID, quando a base ja foi validada no WhatsApp. */
export function findContactByJid(jid: string): Contact | undefined {
  return getDb().select().from(contacts).where(eq(contacts.jid, jid)).get()
}

/**
 * Sincroniza o flag por contato a partir do opt-out global. Mantem a UI
 * coerente: se um numero foi descadastrado em qualquer base, aparece
 * descadastrado em todas.
 */
export function syncOptOutFlags(listId: string): number {
  const rows = getDb()
    .select({ id: contacts.id, phone: contacts.phoneE164 })
    .from(contacts)
    .where(eq(contacts.listId, listId))
    .all()
  const globals = getOptOutSet(rows.map((r) => r.phone))
  const toFlag = rows.filter((r) => globals.has(r.phone)).map((r) => r.id)
  if (toFlag.length > 0) {
    getDb().update(contacts).set({ optOut: 1 }).where(inArray(contacts.id, toFlag)).run()
    scheduleSave()
  }
  return toFlag.length
}
