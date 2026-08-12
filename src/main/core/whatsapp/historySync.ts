import { whatsapp } from './client'
import { inboxEvents, historySyncTypeName } from './inbox'
import {
  countMessages,
  oldestAnchor,
  setChatSync,
  getChat,
  leadChatsNeedingFullSync,
  refreshLeadFlags
} from '../../repos/chats'
import { scoped } from '../../logger'
import { timings } from './historyTimings'
import { recordRequest, pendingFor } from './historyRequests'
import type { ChatSyncOutcome, ChatSyncResult, ChatSyncState, LeadSyncStop } from '@shared/types'

const log = scoped('history')

export { timings }

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

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Puxa o historico de uma conversa ate `days` atras (null = tudo).
 *
 * A resposta do WhatsApp NAO vem no retorno da chamada: ela chega depois, num
 * `messaging-history.set`, e e gravada pelo caminho normal do historico. Por
 * isso cada rodada espera a mensagem mais antiga da conversa andar para tras —
 * quando ela para de andar, e porque o servidor nao tem mais o que mandar.
 *
 * ESPERAR AQUI E UMA CORTESIA COM A TELA, NAO O MECANISMO. Se a resposta nao
 * vier dentro de `roundWaitMs`, esta funcao devolve `awaitingPhone` e para de
 * bombear rodadas — mas o pedido continua vivo em `historyRequests`, e o lote e
 * creditado quando chegar. O erro que a versao anterior cometia era tratar esse
 * prazo como um veredito sobre o aparelho.
 */
export async function syncChatHistory(
  jid: string,
  days: number | null,
  opts: { queueWaitMs?: number } = {}
): Promise<ChatSyncResult> {
  const target = days == null ? 0 : Date.now() - days * DAY_MS
  const before = countMessages(jid)
  const queueWaitMs = opts.queueWaitMs ?? timings.queueWaitMs

  const done = (outcome: ChatSyncOutcome, anchorTs: number | null): ChatSyncResult => {
    const fetched = countMessages(jid) - before

    /**
     * So gravamos quando ALGO foi aprendido sobre a conversa.
     *
     * `busy`, `requestFailed` e `offline` significam que pedido nenhum chegou a
     * ser respondido — carimbar `syncedFrom` neles fazia a conversa parecer
     * sincronizada sem ter sido, e era metade do motivo de a tela mentir.
     */
    const aprendeu = outcome === 'reachedTarget' || outcome === 'exhausted' || outcome === 'fetched'
    if (aprendeu && anchorTs != null) {
      setChatSync(jid, {
        syncedFrom: anchorTs,
        // "Completa" so quando o celular RESPONDEU e nao tinha mais passado.
        // Nem alcancar a janela de 7/30 dias nem um silencio do aparelho valem
        // como fim da conversa.
        syncedFull: outcome === 'exhausted'
      })
    }

    log.info('conversa sincronizada', {
      jid,
      dias: days ?? 'tudo',
      novas: fetched,
      desfecho: outcome
    })
    inboxEvents.emit('changed', { chatJid: jid })
    return { jid, fetched, outcome, pendingRequests: pendingFor(jid).length }
  }

  if (!whatsapp.socket) return done('offline', null)

  let anchor = oldestAnchor(jid)
  if (!anchor) {
    // Sem ancora nao ha o que pedir: o `fetchMessageHistory` do WhatsApp
    // localiza "antes de qual" pela tupla (id, fromMe, carimbo), e o celular
    // so responde se conseguir resolve-la. Conversa vazia, ou conversa em que
    // tudo que existe foi o proprio app que gravou ao enviar, nao tem essa
    // tupla — e pedir com uma tupla inventada e o que produzia minutos de
    // silencio lidos como "o aparelho esta offline".
    return done('noAnchor', null)
  }

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (anchor.ts <= target) return done('reachedTarget', anchor.ts)
    if (!whatsapp.socket) return done('offline', anchor.ts)

    /**
     * O ouvinte entra em cena ANTES do pedido sair.
     *
     * O lote de resposta e emitido no event loop do Baileys e pode chegar
     * enquanto o `await` do envio ainda esta pendente. Registrando so depois
     * (o que o codigo fazia), essa resposta caia no vazio e o resultado ficava
     * indistinguivel de celular offline. Agora tudo que chega e guardado e
     * reavaliado quando o id do pedido fica conhecido.
     */
    const espera = listenForAnswer(jid)
    const pedido = await whatsapp.fetchOlderMessages(anchor, BATCH, {
      waitForSlotMs: queueWaitMs
    })

    if (!pedido.sent) {
      espera.cancel()
      if (pedido.reason === 'offline') return done('offline', anchor.ts)
      if (pedido.reason === 'busy') {
        // A vaga na fila nao abriu a tempo. NENHUM pedido saiu — isto nao pode
        // virar frase sobre o celular, nem carimbar a conversa.
        log.warn('a fila de pedidos de historico nao liberou a vez', { jid, queueWaitMs })
        return done('busy', anchor.ts)
      }
      return done('requestFailed', anchor.ts)
    }

    // O pedido passa a ter vida propria a partir daqui: mesmo que esta chamada
    // desista de esperar, o registro continua ouvindo por ele.
    recordRequest(jid, pedido.requestId)

    const answered = await espera.settle(pedido.requestId)
    if (!answered) {
      log.info('pedido de historico ainda sem resposta; segue pendente', {
        jid,
        requestId: pedido.requestId,
        esperouMs: timings.roundWaitMs
      })
      return done('awaitingPhone', anchor.ts)
    }

    const oldest = oldestAnchor(jid)
    if (!oldest || oldest.ts >= anchor.ts) {
      // Respondeu, mas sem nada anterior ao que ja tinhamos: acabou o passado.
      // Vale como prova de fim de conversa mesmo com `fetched === 0` — o que
      // importa e o aparelho ter FALADO, nao a rodada ter trazido algo.
      return done('exhausted', anchor.ts)
    }
    anchor = oldest
  }

  return done('fetched', anchor.ts)
}

interface HistoryBatch {
  requestId: string | null
  syncType?: number | null
  inserted: Record<string, number>
  jids: string[]
}

/** Espera armada antes do pedido sair, resolvida depois que ele sai. */
interface AnswerWatch {
  /** Arma o prazo e julga (inclusive o que ja chegou) com o id agora conhecido. */
  settle(requestId: string | null): Promise<boolean>
  /** Desiste sem esperar — usado quando o pedido nem chegou a sair. */
  cancel(): void
}

/**
 * Escuta os lotes de historico e diz se algum respondeu a ESTE pedido.
 *
 * DUAS FASES, e nao uma espera simples, por causa de uma corrida: o lote e
 * emitido no event loop do Baileys e pode chegar antes do `await` do envio
 * resolver. Assinando so depois disso, a resposta se perdia e o pedido morria
 * por timeout como se o celular estivesse mudo. Aqui a assinatura acontece
 * antes do envio e o que chega no meio fica guardado ate o `settle`.
 *
 * O casamento e pelo `peerDataRequestSessionId` que o WhatsApp devolve no lote
 * (`requestId` aqui). Como nem toda versao preenche esse campo, aceitamos
 * tambem um lote que fale da mesma conversa — mas nunca o mero passar do tempo:
 * era exatamente isso que fazia o app concluir "acabou o historico" quando na
 * verdade o celular estava offline.
 *
 * DIAGNOSTICO: todo lote que chega e NAO casa vira log. "Nenhum lote chegou" e
 * "chegaram lotes, nenhum era meu" tem causas diferentes — o primeiro e celular
 * calado, o segundo e o casamento errando — e ate aqui os dois terminavam no
 * mesmo aviso generico de timeout.
 */
function listenForAnswer(jid: string): AnswerWatch {
  /** Lotes que chegaram antes do `settle`, ainda sem id de pedido para comparar. */
  const pendentes: HistoryBatch[] = []
  /** Lotes que chegaram durante a espera sem serem a resposta deste pedido. */
  const naoCasaram: string[] = []

  let requestId: string | null = null
  let settled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let resolveAnswer: ((answered: boolean) => void) | null = null

  const combina = (batch: HistoryBatch): boolean => {
    const meu = requestId != null && batch.requestId === requestId
    const mesmaConversa = batch.jids.includes(jid) || batch.inserted[jid] > 0
    if (!meu && !mesmaConversa) {
      naoCasaram.push(
        `${historySyncTypeName(batch.syncType)} req=${batch.requestId ?? '-'} jids=${
          batch.jids.slice(0, 3).join(',') || '-'
        }`
      )
      return false
    }
    log.info('lote de historico casou com o pedido', {
      jid,
      requestId,
      porId: meu,
      tipo: historySyncTypeName(batch.syncType)
    })
    return true
  }

  const finish = (answered: boolean): void => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    inboxEvents.off('historyBatch', onBatch)
    if (!answered) {
      log.info('nenhum lote de historico casou com o pedido dentro do prazo', {
        jid,
        requestId,
        lotesRecebidos: naoCasaram.length,
        // Vazio aqui = o celular nao mandou NADA. Com conteudo = ele falou,
        // mas de outra conversa ou com outro id de sessao.
        detalhe: naoCasaram.slice(0, 5)
      })
    }
    resolveAnswer?.(answered)
  }

  const onBatch = (batch: HistoryBatch): void => {
    if (settled) return
    // Antes do `settle` o id do pedido ainda nao existe: guardar e julgar depois
    // e o que impede a resposta rapida de ser descartada.
    if (!resolveAnswer) {
      pendentes.push(batch)
      return
    }
    if (combina(batch)) finish(true)
  }

  inboxEvents.on('historyBatch', onBatch)

  return {
    settle(id) {
      requestId = id
      return new Promise<boolean>((resolve) => {
        resolveAnswer = resolve
        for (const batch of pendentes) {
          if (combina(batch)) {
            finish(true)
            return
          }
        }
        // O prazo conta a partir daqui: antes do no sair o celular nao tinha
        // como responder.
        timer = setTimeout(() => finish(false), timings.roundWaitMs)
      })
    },
    cancel() {
      settled = true
      if (timer) clearTimeout(timer)
      inboxEvents.off('historyBatch', onBatch)
    }
  }
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
  stoppedReason: null
}
let cancelRequested = false

/**
 * Quais desfechos param a fila, e sob que nome.
 *
 * Os que nao aparecem aqui deixam a fila andar: `exhausted`, `fetched` e
 * `reachedTarget` sao sucesso, e `noAnchor` e uma conversa que nao tinha o que
 * pedir — insistir nela nao ajuda, mas as outras ainda podem render.
 */
const STOP_BY_OUTCOME: Partial<Record<ChatSyncOutcome, LeadSyncStop>> = {
  awaitingPhone: 'phoneQuiet',
  requestFailed: 'requestFailed',
  offline: 'offline',
  busy: 'busy'
}

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
  leadSync = {
    running: true,
    done: 0,
    total: jids.length,
    jid: null,
    fetched: 0,
    stoppedReason: null
  }
  emitLeadSync()

  try {
    for (const jid of jids) {
      if (cancelRequested || !whatsapp.socket) break
      leadSync = { ...leadSync, jid }
      emitLeadSync()

      /**
       * Prazo curto na fila: o trabalho de fundo cede a vez para a tela.
       *
       * Com o prazo longo dos dois lados, abrir uma conversa enquanto a fila
       * roda fazia um dos dois voltar de maos vazias — e a tela reportava isso
       * como se o aparelho tivesse ficado calado.
       */
      const r = await syncChatHistory(jid, null, { queueWaitMs: timings.leadQueueWaitMs })

      /**
       * Cada motivo de parada tem nome proprio.
       *
       * A versao anterior juntava "o celular nao respondeu" com "nao consegui
       * enviar o pedido" num unico `stalled`, e a tela dizia que o aparelho
       * tinha parado de responder mesmo quando pedido nenhum havia saido.
       */
      const parada = STOP_BY_OUTCOME[r.outcome]
      if (parada) {
        leadSync = { ...leadSync, stoppedReason: parada }
        break
      }
      /**
       * `noAnchor` NAO marca mais a conversa como completa.
       *
       * A marcacao existia so para a fila andar, e o preco era gravar "historico
       * completo" numa conversa da qual nao puxamos nada — mentira que a tirava
       * da fila para sempre. Agora quem nao tem ancora nem chega aqui: o
       * `leadChatsNeedingFullSync` ja filtra, e a conversa volta sozinha quando
       * ganhar a primeira mensagem com carimbo do servidor.
       */

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

  /**
   * O que conta como "tentativa gasta".
   *
   * `offline`, `busy` e `requestFailed` nao gastam a vez: nada saiu daqui, e a
   * proxima abertura deve tentar de novo. Ja `awaitingPhone` COM pedido aberto
   * gasta — o aparelho ja esta montando o pacote, e reabrir a conversa nao pode
   * empilhar um pedido novo em cima do que ainda esta de pe. Era assim que uma
   * conversa lenta virava uma rajada de pedidos a cada clique.
   */
  const naoSaiuNada =
    r.outcome === 'offline' || r.outcome === 'busy' || r.outcome === 'requestFailed'
  const podeTentarDeNovo = r.outcome === 'awaitingPhone' && r.pendingRequests === 0
  if (naoSaiuNada || podeTentarDeNovo) autoSynced.delete(jid)
  return r
}

/** Usado no (re)conectar: a sessao de sincronizacao recomeca. */
export function resetAutoSync(): void {
  autoSynced.clear()
}
