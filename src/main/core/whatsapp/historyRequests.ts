import { inboxEvents } from './inbox'
import { timings } from './historyTimings'
import { oldestAnchor, setChatSync } from '../../repos/chats'
import { scoped } from '../../logger'

const log = scoped('history')

/**
 * Registro dos pedidos de historico que ja sairam.
 *
 * PORQUE ISTO EXISTE: o pedido de historico antigo e uma "peer data operation"
 * endereçada ao proprio aparelho pareado, que responde quando consegue — as
 * vezes em minutos, as vezes nunca (o WhatsApp descarta o pedido em silencio
 * para dispositivos companion com alguma frequencia; ver WhiskeySockets/Baileys#2452).
 *
 * Ate aqui o app tratava esse silencio como um evento terminal: esperava 45s
 * dentro da chamada e, ao estourar, dizia ao usuario que "o celular parou de
 * responder". Duas coisas erradas nisso — a acusacao (o aparelho pode estar
 * perfeitamente bem, so lento) e o desperdicio: se a resposta chegasse dois
 * minutos depois, ninguem estava mais ouvindo por ela e o lote era creditado a
 * lugar nenhum.
 *
 * Aqui o pedido passa a ter vida propria, independente da chamada que o
 * originou. Um unico ouvinte permanente casa os lotes que chegam com os pedidos
 * abertos, atualiza a conversa e avisa a tela quando a resposta chega atrasada.
 */

export type RequestStatus = 'aguardando' | 'respondido' | 'expirado'

export interface PendingRequest {
  requestId: string | null
  jid: string
  sentAt: number
  answeredAt: number | null
  /** Mensagens gravadas creditadas a este pedido. */
  inserted: number
  status: RequestStatus
}

/** Lote de historico como o `inbox` o publica. */
interface HistoryBatch {
  requestId: string | null
  syncType?: number | null
  inserted: Record<string, number>
  jids: string[]
}

/** Quantos pedidos guardamos para o diagnostico. */
const HISTORY_LIMIT = 20

let requests: PendingRequest[] = []

/** Marca como expirado o que passou do prazo. Preguicoso: roda na leitura. */
function expireStale(now = Date.now()): void {
  for (const r of requests) {
    if (r.status === 'aguardando' && now - r.sentAt > timings.requestTtlMs) {
      r.status = 'expirado'
    }
  }
}

/** Registra um pedido que ACABOU de sair. */
export function recordRequest(jid: string, requestId: string | null): PendingRequest {
  const req: PendingRequest = {
    requestId,
    jid,
    sentAt: Date.now(),
    answeredAt: null,
    inserted: 0,
    status: 'aguardando'
  }
  requests.push(req)
  if (requests.length > HISTORY_LIMIT) requests = requests.slice(-HISTORY_LIMIT)
  return req
}

/** Pedidos desta conversa ainda sem resposta. */
export function pendingFor(jid: string): PendingRequest[] {
  expireStale()
  return requests.filter((r) => r.jid === jid && r.status === 'aguardando')
}

/** Ultimos pedidos, do mais novo para o mais antigo. Usado no diagnostico. */
export function recentRequests(limit = HISTORY_LIMIT): PendingRequest[] {
  expireStale()
  return requests.slice(-limit).reverse()
}

/** (Re)conectar comeca uma sessao nova: pedido antigo nao vai mais ser respondido. */
export function resetRequests(): void {
  requests = []
}

/**
 * Este lote responde a este pedido?
 *
 * O casamento oficial e pelo `peerDataRequestSessionId` que o WhatsApp devolve
 * no lote. Como nem toda versao preenche esse campo, aceitamos tambem um lote
 * que fale da mesma conversa — mas nunca o mero passar do tempo, que era o que
 * fazia o app concluir "acabou o historico" com o celular apenas offline.
 */
function matches(req: PendingRequest, batch: HistoryBatch): boolean {
  if (req.requestId != null && batch.requestId != null) {
    return batch.requestId === req.requestId
  }
  return batch.jids.includes(req.jid) || (batch.inserted[req.jid] ?? 0) > 0
}

/**
 * Credita um lote aos pedidos abertos.
 *
 * As mensagens em si ja foram gravadas pelo caminho normal do historico
 * (`applyHistorySet`); o que acontece aqui e a contabilidade: fechar o pedido,
 * empurrar o `syncedFrom` da conversa para tras e avisar quem estiver olhando.
 */
function credit(batch: HistoryBatch): void {
  expireStale()
  const abertos = requests.filter((r) => r.status === 'aguardando' && matches(r, batch))
  if (abertos.length === 0) return

  const now = Date.now()
  for (const req of abertos) {
    req.status = 'respondido'
    req.answeredAt = now
    req.inserted = batch.inserted[req.jid] ?? 0

    /**
     * O passado da conversa andou para tras — grave isso.
     *
     * `syncedFull` NAO e tocado aqui: so a chamada que viu o celular responder
     * sem nada anterior pode concluir que a conversa acabou. Um lote atrasado
     * prova que ele falou, nao que nao ha mais historico.
     */
    const anchor = oldestAnchor(req.jid)
    if (anchor) setChatSync(req.jid, { syncedFrom: anchor.ts })

    const atraso = now - req.sentAt
    log.info('lote de historico casou com um pedido aberto', {
      jid: req.jid,
      requestId: req.requestId,
      novas: req.inserted,
      atrasoMs: atraso
    })

    /**
     * A tela ja disse "ainda nao chegou"? Entao ela precisa saber que chegou.
     *
     * Sem este aviso o usuario ficaria com a ultima frase que leu — a de que o
     * pedido estava pendente — enquanto as mensagens ja tinham entrado na
     * conversa.
     */
    if (atraso >= timings.roundWaitMs) {
      inboxEvents.emit('historyLate', { chatJid: req.jid, inserted: req.inserted })
    }
  }
}

/**
 * Ouvinte PERMANENTE, instalado no import.
 *
 * Antes cada rodada assinava e desassinava o proprio ouvinte, o que fazia o
 * casamento so existir durante a espera — e a resposta atrasada cair no vazio.
 */
inboxEvents.on('historyBatch', (batch: HistoryBatch) => {
  try {
    credit(batch)
  } catch (e) {
    log.warn('falha ao creditar lote de historico', e)
  }
})
