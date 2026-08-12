import { sql } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { lidMap, lidProbe } from '../db/schema'

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

/**
 * Tira o sufixo de dispositivo do endereco.
 *
 * `71700301529149:23@lid` e `71700301529149@lid` sao A MESMA PESSOA — o `:23` e
 * so qual aparelho dela mandou. O log real tem 7 dos 46 LIDs aparecendo nas duas
 * formas, e comparar por igualdade crua fazia esses nunca casarem: nem no mapa,
 * nem na hora de fundir a conversa.
 *
 * O resto do codigo ja faz isso ha tempos pelo mesmo motivo — ver `jidToE164`
 * (`optOutDetect.ts`) e `formatJid` (renderer).
 */
export function normalizeLid(lid: string): string {
  const [user, dominio] = lid.split('@')
  return dominio ? `${user.split(':')[0]}@${dominio}` : lid
}

/** lid (normalizado) -> jid de telefone. */
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
    const lid = normalizeLid(row.lid)
    byLid.set(lid, row.jid)
    byJid.set(row.jid, lid)
    if (row.source === 'senderPn') fromEnvelope.add(lid)
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
export function rememberLid(lidBruto: string, jid: string, source: LidSource): void {
  load()
  const lid = normalizeLid(lidBruto)
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
  return byLid.get(normalizeLid(lid)) ?? null
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
 * Toda conversa cuja CHAVE ainda e um LID.
 *
 * Sao as linhas duplicadas: a mesma pessoa tem outra conversa pelo telefone.
 * A resolucao acontece aqui em JS, e nao em SQL, por causa do sufixo de
 * dispositivo — `71700301529149:23@lid` precisa achar o mapa gravado em
 * `71700301529149@lid`, e escrever esse `substr`/`instr` em SQL so tornaria a
 * regra dificil de ler sem ganhar nada (sao dezenas de linhas, nao milhares).
 */
function lidChats(): string[] {
  return getDb()
    .all<{ jid: string }>(sql`SELECT jid FROM chats WHERE jid LIKE '%@lid'`)
    .map((r) => r.jid)
}

/**
 * Conversas endereçadas por LID que ainda nao sabemos traduzir.
 *
 * E o que a varredura por USync tenta resolver, e o que o diagnostico mostra:
 * enquanto for maior que zero, ha conversa que o app nao consegue atribuir a
 * ninguem.
 */
export function unmappedLidChats(): number {
  load()
  return lidChats().filter((jid) => !pnForLid(jid)).length
}

/**
 * Telefones da base que ainda nao tem LID conhecido.
 *
 * Alimenta a varredura por USync. Sao os numeros com quem podemos vir a
 * conversar — se o WhatsApp endereçar a conversa por LID e nao soubermos
 * traduzir, a mensagem fica sem dono.
 */
export function phonesNeedingLid(limit = 200): string[] {
  load()
  const rows = getDb().all<{ phone: string }>(
    sql`SELECT DISTINCT phone_e164 AS phone FROM contacts
        WHERE phone_e164 IS NOT NULL
          AND (contacts.jid IS NULL
               OR NOT EXISTS (SELECT 1 FROM lid_map m WHERE m.jid = contacts.jid))
          AND NOT EXISTS (SELECT 1 FROM lid_probe p WHERE p.phone = contacts.phone_e164)
        LIMIT ${limit}`
  )
  return rows.map((r) => r.phone)
}

/**
 * Marca que ja perguntamos por estes numeros.
 *
 * Quem respondeu com LID entra no `lid_map` e sai da fila por ali; quem nao
 * respondeu precisa deste registro, senao a varredura refaz as mesmas consultas
 * a cada conexao — para sempre, e sem nunca aprender nada.
 */
export function markLidProbed(phones: string[]): void {
  if (phones.length === 0) return
  const at = Date.now()
  const db = getDb()
  for (const phone of phones) {
    db.insert(lidProbe).values({ phone, at }).onConflictDoNothing().run()
  }
  scheduleSave()
}

/**
 * Conversas endereçadas por LID que JA sabemos traduzir — o alvo do merge.
 *
 * Devolve a chave REAL da conversa (com sufixo de dispositivo, se houver), que e
 * o que o merge precisa para achar a linha, junto do telefone canonico.
 *
 * O par no `lid_map` NAO e apagado depois de fundir: ele continua sendo a unica
 * traducao das mensagens que ainda vao chegar por aquele LID.
 */
export function mappedLidChats(): { lid: string; jid: string }[] {
  load()
  const pares: { lid: string; jid: string }[] = []
  for (const chatJid of lidChats()) {
    const pn = pnForLid(chatJid)
    if (pn) pares.push({ lid: chatJid, jid: pn })
  }
  return pares
}
