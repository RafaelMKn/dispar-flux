import { sql } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { lidMap } from '../db/schema'

/**
 * Mapa LID -> telefone.
 *
 * O WhatsApp esta migrando o endereçamento das conversas de numero para LID
 * (`71700301529149@lid`), um identificador opaco sem relacao nenhuma com o
 * telefone. Sem traduzir isso, a mesma pessoa vira duas conversas: uma pelo
 * numero (criada pelo disparo) e outra pelo LID (criada pela resposta dela).
 *
 * CACHE EM MEMORIA porque isto e consultado em TODA mensagem que entra —
 * inclusive nas dezenas de milhares que chegam num lote de historico. Uma ida
 * ao sql.js por mensagem seria sentida na tela.
 */

/** lid -> jid de telefone. */
const byLid = new Map<string, string>()
/** jid de telefone -> lid. */
const byJid = new Map<string, string>()
/** Quem veio do envelope nao pode ser sobrescrito por consulta (ver abaixo). */
const fromEnvelope = new Set<string>()

let loaded = false

export type LidSource = 'senderPn' | 'usync'

function load(): void {
  if (loaded) return
  loaded = true
  for (const row of getDb().select().from(lidMap).all()) {
    byLid.set(row.lid, row.jid)
    byJid.set(row.jid, row.lid)
    if (row.source === 'senderPn') fromEnvelope.add(row.lid)
  }
}

/**
 * Guarda o par, se ele for novidade ou vier de fonte melhor.
 *
 * `senderPn` ganha de `usync`: o primeiro vem no proprio envelope da mensagem,
 * dito pelo servidor sobre aquela conversa; o segundo e uma consulta nossa, que
 * pode devolver o LID de um numero que a pessoa nao usa mais. Sem esta regra,
 * uma varredura em segundo plano poderia sobrescrever um mapeamento certo.
 */
export function rememberLid(lid: string, jid: string, source: LidSource): void {
  load()
  const atual = byLid.get(lid)
  if (atual === jid && (source === 'senderPn') === fromEnvelope.has(lid)) return
  if (atual && atual !== jid && fromEnvelope.has(lid) && source === 'usync') return

  byLid.set(lid, jid)
  byJid.set(jid, lid)
  if (source === 'senderPn') fromEnvelope.add(lid)

  getDb()
    .insert(lidMap)
    .values({ lid, jid, source, at: Date.now() })
    .onConflictDoUpdate({
      target: lidMap.lid,
      set: { jid, source, at: Date.now() }
    })
    .run()
  scheduleSave()
}

/** Telefone por tras deste LID, ou null se ainda nao sabemos. */
export function pnForLid(lid: string): string | null {
  load()
  return byLid.get(lid) ?? null
}

/** LID deste telefone, ou null. Usado para falar com o servidor. */
export function lidForPn(jid: string): string | null {
  load()
  return byJid.get(jid) ?? null
}

/** Quantos pares conhecemos. Vai para o diagnostico. */
export function countLidMappings(): number {
  load()
  return byLid.size
}

/** Esquece tudo em memoria. So para o teste — o banco continua a verdade. */
export function resetLidCache(): void {
  loaded = false
  byLid.clear()
  byJid.clear()
  fromEnvelope.clear()
}

/**
 * Conversas ainda endereçadas por LID que nao sabemos traduzir.
 *
 * E o que a varredura por USync tenta resolver, e o que o diagnostico mostra:
 * enquanto for maior que zero, ha mensagem que o app nao consegue atribuir a
 * ninguem.
 */
export function unmappedLidChats(): number {
  load()
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(sql`chats`)
      .where(
        sql`chats.jid LIKE '%@lid' AND NOT EXISTS (
        SELECT 1 FROM lid_map m WHERE m.lid = chats.jid
      )`
      )
      .get()?.n ?? 0
  )
}

/**
 * Conversas endereçadas por LID que JA sabemos traduzir — o alvo do merge.
 *
 * O par NAO e apagado depois de fundir a conversa: ele continua sendo a unica
 * forma de canonicalizar as mensagens que ainda vao chegar com aquele LID.
 */
export function mappedLidChats(): { lid: string; jid: string }[] {
  load()
  return getDb()
    .select({ lid: lidMap.lid, jid: lidMap.jid })
    .from(lidMap)
    .where(sql`EXISTS (SELECT 1 FROM chats c WHERE c.jid = ${lidMap.lid})`)
    .all()
}
