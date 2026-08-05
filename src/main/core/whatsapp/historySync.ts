import { whatsapp } from './client'
import { inboxEvents } from './inbox'
import {
  countMessages,
  oldestMessage,
  setChatSync,
  getChat,
  leadChatsNeedingFullSync,
  refreshLeadFlags
} from '../../repos/chats'
import { scoped } from '../../logger'
import type { ChatSyncResult, ChatSyncState } from '@shared/types'

const log = scoped('history')

/**
 * Sincronizacao de historico SOB DEMANDA, por conversa.
 *
 * O `messaging-history.set` que o WhatsApp manda no pareamento e um recorte que
 * ele escolhe — nunca a conversa inteira, e nunca na hora em que o usuario
 * precisa. Este modulo pede o resto: uma conversa por vez, ate a data pedida
 * (7 dias, 30 dias) ou ate o servidor dizer que nao ha mais passado.
 *
 * PACING: cada rodada e uma requisicao ao servidor do WhatsApp. Rajada de
 * requisicao e o padrao de trafego que faz o numero ser bloqueado, entao aqui
 * tudo e sequencial, com espera pela resposta e um teto de rodadas — a mesma
 * disciplina do intervalo entre disparos.
 */

/** Mensagens pedidas por rodada. Acima disso o servidor costuma ignorar. */
const BATCH = 50

/** Teto de rodadas por conversa, para um "sincronizar tudo" nao virar infinito. */
const MAX_ROUNDS = 40

/**
 * Tempos da espera por uma rodada.
 *
 * Ficam num objeto, e nao em constantes soltas, para o teste poder encurta-los:
 * o caminho "o celular nao respondeu" so termina depois do timeout, e esperar
 * 45s de verdade em teste nao prova nada alem de paciencia.
 */
export const timings = {
  /**
   * Quanto esperamos o CELULAR responder um pedido de historico.
   *
   * Nao e o servidor do WhatsApp que responde: e o aparelho pareado, que pode
   * estar com a tela apagada, em rede ruim ou com o app fechado. 45s e
   * generoso de proposito — desistir cedo demais era o que produzia o
   * diagnostico errado de "essa conversa acabou".
   */
  roundTimeoutMs: 45_000,
  /** Espera quando outro pedido de historico esta no cooldown. */
  retryMs: 2_000
}

const DAY_MS = 24 * 60 * 60 * 1000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Puxa o historico de uma conversa ate `days` atras (null = tudo).
 *
 * A resposta do WhatsApp NAO vem no retorno da chamada: ela chega depois, num
 * `messaging-history.set`, e e gravada pelo caminho normal do historico. Por
 * isso cada rodada espera a mensagem mais antiga da conversa andar para tras —
 * quando ela para de andar, e porque o servidor nao tem mais o que mandar.
 */
export async function syncChatHistory(jid: string, days: number | null): Promise<ChatSyncResult> {
  const target = days == null ? 0 : Date.now() - days * DAY_MS
  const before = countMessages(jid)

  const result: ChatSyncResult = {
    jid,
    fetched: 0,
    reachedTarget: false,
    exhausted: false,
    noAnchor: false,
    offline: false,
    timedOut: false
  }

  if (!whatsapp.socket) {
    result.offline = true
    return result
  }

  let anchor = oldestMessage(jid)
  if (!anchor) {
    // Sem nenhuma mensagem local nao ha ancora: o `fetchMessageHistory` do
    // WhatsApp pede a chave de uma mensagem para saber "antes de qual". Uma
    // conversa que nunca recebeu nada da sincronizacao inicial so aparece
    // quando o proprio WhatsApp a mandar (ou quando alguem escrever nela).
    result.noAnchor = true
    return result
  }

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (anchor.ts <= target) {
      result.reachedTarget = true
      break
    }
    if (!whatsapp.socket) {
      result.offline = true
      break
    }

    const requestId = await whatsapp.fetchOlderMessages(anchor, BATCH)
    if (requestId === null) {
      // Cooldown de outro pedido em andamento: espera e tenta a mesma rodada.
      await sleep(timings.retryMs)
      continue
    }

    const answered = await waitForAnswer(jid, requestId)
    if (!answered) {
      /**
       * O celular nao respondeu dentro do prazo.
       *
       * Isto NAO significa que a conversa acabou — significa que o aparelho
       * esta offline, com o WhatsApp fechado ou em rede ruim. Tratar como fim
       * do historico (o que o codigo fazia antes) marcava a conversa como
       * "completa" com zero mensagens e a tirava da fila para sempre.
       */
      result.timedOut = true
      log.warn('o celular nao respondeu ao pedido de historico', { jid, requestId })
      break
    }

    const oldest = oldestMessage(jid)
    if (!oldest || oldest.ts >= anchor.ts) {
      // Respondeu, mas sem nada anterior ao que ja tinhamos: acabou o passado.
      result.exhausted = true
      break
    }
    anchor = oldest
  }

  result.fetched = countMessages(jid) - before
  setChatSync(jid, {
    syncedFrom: anchor.ts,
    // "Completa" so quando o celular RESPONDEU e nao tinha mais passado. Nem
    // alcancar a janela de 7/30 dias nem um silencio do aparelho valem como
    // fim da conversa.
    syncedFull: result.exhausted
  })
  log.info('conversa sincronizada', {
    jid,
    dias: days ?? 'tudo',
    novas: result.fetched,
    ateOFim: result.exhausted,
    semResposta: result.timedOut
  })
  inboxEvents.emit('changed', { chatJid: jid })
  return result
}

interface HistoryBatch {
  requestId: string | null
  inserted: Record<string, number>
  jids: string[]
}

/**
 * Espera o lote de historico que responde a ESTE pedido.
 *
 * O casamento e pelo `peerDataRequestSessionId` que o WhatsApp devolve no lote
 * (`requestId` aqui). Como nem toda versao preenche esse campo, aceitamos
 * tambem um lote que fale da mesma conversa — mas nunca o mero passar do tempo:
 * era exatamente isso que fazia o app concluir "acabou o historico" quando na
 * verdade o celular estava offline.
 */
function waitForAnswer(jid: string, requestId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (answered: boolean): void => {
      clearTimeout(timer)
      inboxEvents.off('historyBatch', onBatch)
      resolve(answered)
    }

    const onBatch = (batch: HistoryBatch): void => {
      const meu = requestId && batch.requestId === requestId
      const mesmaConversa = batch.jids.includes(jid) || batch.inserted[jid] > 0
      if (meu || mesmaConversa) done(true)
    }

    const timer = setTimeout(() => done(false), timings.roundTimeoutMs)
    inboxEvents.on('historyBatch', onBatch)
  })
}

/* ── Fila da base de leads ───────────────────────────────────────────────── */

/**
 * Sincroniza por INTEIRO as conversas de quem esta na base de leads.
 *
 * E a decisao de foco do produto: quem esta na base importa 100% (a conversa
 * toda), e o resto da inbox se contenta com a janela que o WhatsApp mandou. Sem
 * isso, sincronizar tudo de todo mundo era o que deixava o app inutilizavel em
 * conta grande.
 *
 * Roda em segundo plano, uma conversa por vez, e pode ser interrompida.
 */
let leadSync: ChatSyncState = {
  running: false,
  done: 0,
  total: 0,
  jid: null,
  fetched: 0,
  stalled: false
}
let cancelRequested = false

export function getLeadSyncState(): ChatSyncState {
  return { ...leadSync }
}

function emitLeadSync(): void {
  inboxEvents.emit('leadSync', getLeadSyncState())
}

export function cancelLeadSync(): void {
  if (leadSync.running) cancelRequested = true
}

export async function syncLeadChats(maxChats = 50): Promise<ChatSyncState> {
  if (leadSync.running) return getLeadSyncState()

  refreshLeadFlags()
  const jids = leadChatsNeedingFullSync(maxChats)
  cancelRequested = false
  leadSync = { running: true, done: 0, total: jids.length, jid: null, fetched: 0, stalled: false }
  emitLeadSync()

  try {
    for (const jid of jids) {
      if (cancelRequested || !whatsapp.socket) break
      leadSync = { ...leadSync, jid }
      emitLeadSync()

      const r = await syncChatHistory(jid, null)
      if (r.offline) break
      // Celular sem responder: parar a fila. Insistir nas outras 40 conversas
      // so gastaria meia hora repetindo o mesmo silencio.
      if (r.timedOut) {
        leadSync = { ...leadSync, stalled: true }
        break
      }
      // Conversa sem ancora nao adianta reprocessar a cada clique: marcamos
      // como resolvida para a fila andar, e ela volta quando tiver mensagem.
      if (r.noAnchor) setChatSync(jid, { syncedFull: true })

      leadSync = { ...leadSync, done: leadSync.done + 1, fetched: leadSync.fetched + r.fetched }
      emitLeadSync()
    }
  } finally {
    leadSync = { ...leadSync, running: false, jid: null }
    emitLeadSync()
    inboxEvents.emit('changed', { chatJid: '*' })
  }
  return getLeadSyncState()
}

/**
 * Sincronizacao automatica ao abrir uma conversa pouco sincronizada.
 *
 * Sete dias por padrao — o suficiente para a conversa nao abrir vazia — e trinta
 * para quem esta na base de leads, que e o foco. Nao repete na mesma sessao:
 * abrir e fechar a mesma conversa nao pode virar uma sequencia de requisicoes.
 */
const autoSynced = new Set<string>()

export const AUTO_SYNC_DAYS = 7
export const AUTO_SYNC_DAYS_LEAD = 30

export async function autoSyncOnOpen(jid: string): Promise<ChatSyncResult | null> {
  if (autoSynced.has(jid)) return null
  const chat = getChat(jid)
  if (!chat) return null

  const days = chat.isLead === 1 ? AUTO_SYNC_DAYS_LEAD : AUTO_SYNC_DAYS
  // Ja temos passado suficiente? Entao nao ha o que pedir.
  if (chat.syncedFull === 1) return null
  if (chat.syncedFrom != null && chat.syncedFrom <= Date.now() - days * DAY_MS) return null

  autoSynced.add(jid)
  const r = await syncChatHistory(jid, days)
  // Sem resposta do celular (ou sem conexao) nao conta como tentativa gasta: o
  // aparelho pode voltar em um minuto e a proxima abertura deve tentar de novo.
  if (r.timedOut || r.offline) autoSynced.delete(jid)
  return r
}

/** Usado no (re)conectar: a sessao de sincronizacao recomeca. */
export function resetAutoSync(): void {
  autoSynced.clear()
}
