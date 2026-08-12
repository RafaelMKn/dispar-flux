import { EventEmitter } from 'node:events'
import {
  upsertChat,
  incrementUnread,
  insertMessages,
  advanceMessageStatus,
  setMediaState,
  getMessageRow,
  oldestMessage,
  setChatSync,
  refreshLeadFlags,
  type InsertMessageInput
} from '../../repos/chats'
import { addOptOut } from '../../repos/optOuts'
import { handleInbound } from '../crm/leads'
import { isOptOutRequest, jidToE164 } from './optOutDetect'
import { canonicalJid, isLid } from './lid'
import { scoped } from '../../logger'
import { saveNow, withBulkWrite } from '../../db'
import { saveMedia } from './mediaStore'
import type { MediaKind, MessageDirection, MessageStatus } from '@shared/types'

const log = scoped('inbox')

/** Emite 'changed' com { chatJid, optOut? } para o IPC repassar ao renderer. */
export const inboxEvents = new EventEmitter()

/**
 * Ponte para o Baileys, injetada pelo client.
 *
 * PORQUE INJETADA: este modulo trata a logica da inbox e precisa ser testavel,
 * mas o `baileys` e ESM-only e so carrega por `import()` dinamico dentro do
 * Electron. Importa-lo aqui arrastaria o pacote inteiro para dentro dos testes.
 * Alem disso o client ja importa este modulo — importar de volta fecharia um
 * ciclo.
 */
export interface MediaBridge {
  /** Serializa a mensagem do Baileys para guardar no banco (protobuf/base64). */
  encode: (msg: unknown) => string | null
  /** Baixa o anexo a partir do que `encode` gravou. */
  download: (raw: string) => Promise<{ data: Buffer; mime: string | null }>
}

let bridge: MediaBridge | null = null

export function setMediaBridge(next: MediaBridge | null): void {
  bridge = next
}

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

/* ── Leitura da mensagem do Baileys ──────────────────────────────────────── */

interface WaMessageContent {
  conversation?: string
  extendedTextMessage?: { text?: string }
  imageMessage?: WaMedia
  videoMessage?: WaMedia
  documentMessage?: WaMedia
  audioMessage?: WaMedia
  stickerMessage?: WaMedia
  ephemeralMessage?: { message?: WaMessageContent }
  viewOnceMessage?: { message?: WaMessageContent }
  viewOnceMessageV2?: { message?: WaMessageContent }
  documentWithCaptionMessage?: { message?: WaMessageContent }
}

interface WaMedia {
  caption?: string | null
  mimetype?: string | null
  fileName?: string | null
  fileLength?: number | Long | null
  seconds?: number | null
  ptt?: boolean | null
}

interface Long {
  toNumber: () => number
}

function toNumber(value: number | Long | null | undefined): number | null {
  if (value == null) return null
  return typeof value === 'number' ? value : value.toNumber()
}

/**
 * Remove os involucros que o WhatsApp usa para mensagens temporarias, de
 * visualizacao unica e documento-com-legenda. Sem isso toda mensagem que passa
 * por um desses modos apareceria vazia na conversa.
 */
function unwrap(message: WaMessageContent | null | undefined): WaMessageContent | null {
  if (!message) return null
  const inner =
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message.documentWithCaptionMessage?.message
  return inner ? unwrap(inner) : message
}

/** Texto proprio da mensagem (ou legenda da midia). null quando nao ha. */
export function extractText(raw: WaMessageContent | null | undefined): string | null {
  const m = unwrap(raw)
  if (!m) return null
  if (typeof m.conversation === 'string' && m.conversation) return m.conversation
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text
  return (
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.audioMessage?.caption ||
    null
  )
}

export interface MediaInfo {
  kind: MediaKind
  mime: string | null
  name: string | null
  size: number | null
  seconds: number | null
  ptt: boolean
}

/** Descreve o anexo da mensagem, ou null se for so texto. */
export function describeMedia(raw: WaMessageContent | null | undefined): MediaInfo | null {
  const m = unwrap(raw)
  if (!m) return null

  const found: [MediaKind, WaMedia | undefined][] = [
    ['image', m.imageMessage],
    ['video', m.videoMessage],
    ['audio', m.audioMessage],
    ['document', m.documentMessage],
    ['sticker', m.stickerMessage]
  ]

  for (const [kind, media] of found) {
    if (!media) continue
    return {
      kind,
      mime: media.mimetype ?? null,
      name: media.fileName ?? null,
      size: toNumber(media.fileLength),
      seconds: media.seconds ?? null,
      ptt: media.ptt === true
    }
  }
  return null
}

/** Rotulo curto para a previa da conversa na lista lateral. */
export function previewLabel(media: MediaInfo | null, text: string | null): string | null {
  if (text) return text
  if (!media) return null
  switch (media.kind) {
    case 'image':
      return '[imagem]'
    case 'video':
      return '[video]'
    case 'audio':
      return media.ptt ? '[audio]' : '[arquivo de audio]'
    case 'sticker':
      return '[figurinha]'
    case 'document':
      return `[documento: ${media.name ?? 'arquivo'}]`
  }
}

/**
 * Quais anexos baixamos sozinhos.
 *
 * Imagem, figurinha e audio sao pequenos e a conversa fica ilegivel sem eles.
 * Video e documento podem ter dezenas de MB e nem sempre interessam — esses so
 * baixam quando o usuario clica, para nao encher o disco de quem so queria ler
 * a conversa.
 */
const AUTO_DOWNLOAD: ReadonlySet<MediaKind> = new Set<MediaKind>(['image', 'audio', 'sticker'])

/** Teto de seguranca: nem um anexo "pequeno" deve baixar sozinho se vier enorme. */
const AUTO_DOWNLOAD_MAX_BYTES = 16 * 1024 * 1024

function shouldAutoDownload(media: MediaInfo): boolean {
  if (!AUTO_DOWNLOAD.has(media.kind)) return false
  return (media.size ?? 0) <= AUTO_DOWNLOAD_MAX_BYTES
}

/* ── Entrada de mensagens ────────────────────────────────────────────────── */

interface WaMessageLike {
  key?: {
    id?: string | null
    remoteJid?: string | null
    fromMe?: boolean | null
    /**
     * Telefone por tras do `remoteJid` quando ele e um LID.
     *
     * O Baileys preenche isto a partir do envelope (`sender_pn` na stanza). So
     * vem nas mensagens RECEBIDAS — as `fromMe` chegam sem, e por isso o par e
     * gravado no `lid_map` assim que aparece. Ver `canonicalJid`.
     */
    senderPn?: string | null
  }
  message?: WaMessageContent | null
  pushName?: string | null
  messageTimestamp?: number | Long | null
  status?: number | string | null
}

/** Carimbo mais antigo que aceitamos como plausivel (2008; o WhatsApp e de 2009). */
const MIN_PLAUSIBLE_MS = 1_200_000_000_000
const DAY_IN_MS = 24 * 60 * 60 * 1000

/**
 * O carimbo do SERVIDOR em ms, ou null quando a mensagem nao trouxe nenhum.
 *
 * Nao ha fallback aqui de proposito. O `ts` de exibicao ainda cai em
 * `Date.now()` quando nao ha carimbo (a mensagem precisa aparecer em algum
 * lugar da lista), mas quem precisa do carimbo que o CELULAR conhece — o pedido
 * de historico antigo — tem que conseguir distinguir "veio" de "nao veio". Era
 * justamente a ausencia dessa distincao que mandava um `Date.now()` como ancora
 * e fazia o aparelho ignorar o pedido em silencio.
 */
export function serverMillis(ts: WaMessageLike['messageTimestamp']): number | null {
  if (ts == null) return null
  const n = typeof ts === 'number' ? ts : ts.toNumber()
  if (!Number.isFinite(n) || n <= 0) return null
  // O WhatsApp manda em segundos.
  const ms = n < 1e12 ? n * 1000 : n
  // Carimbo absurdo (mensagem corrompida) geraria uma ancora irresolvivel, com
  // o mesmo sintoma de silencio de 45s. Melhor nao ter ancora do que ter uma ruim.
  if (ms < MIN_PLAUSIBLE_MS || ms > Date.now() + DAY_IN_MS) return null
  return ms
}

/** Enum de status do Baileys (WAMessageStatus) para o nosso vocabulario. */
export function mapStatus(status: number | string | null | undefined): MessageStatus | null {
  switch (status) {
    case 0:
    case 'ERROR':
      return 'error'
    case 1:
    case 'PENDING':
      return 'pending'
    case 2:
    case 'SERVER_ACK':
      return 'sent'
    case 3:
    case 'DELIVERY_ACK':
      return 'delivered'
    case 4:
    case 'READ':
    case 5:
    case 'PLAYED':
      return 'read'
    default:
      return null
  }
}

export interface UpsertOptions {
  /**
   * Mensagem vinda da sincronizacao de historico, nao ao vivo.
   *
   * Historico nao pode incrementar nao-lidas (o usuario ja leu no celular) nem
   * disparar opt-out retroativo — um "SAIR" de meses atras seria processado
   * como se tivesse acabado de chegar.
   */
  history?: boolean
}

/**
 * Processa mensagens vindas de `messages.upsert` (ao vivo) e da sincronizacao
 * de historico.
 *
 * Idempotente: usa o id da mensagem como chave primaria, entao reemissao pelo
 * Baileys (comum apos reconexao) nao duplica nada.
 */
export function handleUpsert(msgs: WaMessageLike[], opts: UpsertOptions = {}): void {
  // Uma so gravacao em disco para o lote inteiro: o `saveNow` exporta o banco
  // completo, e faze-lo por mensagem era o que travava a sincronizacao.
  withBulkWrite(() => {
    const parsed: ParsedMessage[] = []
    for (const msg of msgs) {
      try {
        const one = parseOne(msg)
        if (one) parsed.push(one)
      } catch (e) {
        log.error('falha ao processar mensagem', e)
      }
    }
    if (parsed.length === 0) return

    const byId = new Map(parsed.map((p) => [p.input.id, p]))
    const inserted = insertMessages(parsed.map((p) => p.input))

    for (const row of inserted) {
      const one = byId.get(row.id)
      if (!one) continue
      try {
        afterInsert(one, opts)
      } catch (e) {
        log.error('falha ao processar mensagem', e)
      }
    }
  })
}

interface ParsedMessage {
  input: InsertMessageInput
  /** Sempre o telefone: e a chave da conversa. */
  jid: string
  /** Endereco de protocolo, quando o servidor endereça esta conversa por LID. */
  lid: string | null
  direction: MessageDirection
  ts: number
  text: string | null
  preview: string | null
  pushName: string | null
  hasMedia: boolean
  autoDownload: boolean
}

function parseOne(msg: WaMessageLike): ParsedMessage | null {
  const bruto = msg.key?.remoteJid
  if (isIgnorableJid(bruto)) return null

  /**
   * A conversa e sempre chaveada pelo TELEFONE, nunca pelo LID.
   *
   * Sem isto a mesma pessoa vira duas conversas: a que o disparo criou pelo
   * numero e a que a resposta dela criou pelo LID — e so a primeira casa com a
   * base de leads e com o CRM.
   */
  const jid = canonicalJid(bruto, { senderPn: msg.key?.senderPn })
  if (!jid) {
    // LID de quem ainda nao sabemos o telefone. Deixar entrar com o LID cru e
    // o que produzia a duplicata; a varredura por USync resolve e a mensagem
    // volta pelo historico depois.
    log.warn('mensagem de um LID ainda sem telefone conhecido', { lid: bruto })
    return null
  }

  const id = msg.key?.id
  if (!id) return null

  const text = extractText(msg.message)
  const media = describeMedia(msg.message)
  // Sem texto e sem midia (ex.: reacoes, protocolos) — nao vira mensagem.
  if (text === null && !media) return null

  const direction: MessageDirection = msg.key?.fromMe ? 'out' : 'in'
  // `waTs` e a unica fonte de ancora do pedido de historico, e este e o unico
  // lugar do app que o preenche: so o que veio do Baileys carrega o carimbo
  // que o celular conhece.
  const waTs = serverMillis(msg.messageTimestamp)
  const ts = waTs ?? Date.now()

  return {
    input: {
      id,
      chatJid: jid,
      direction,
      body: text,
      ts,
      waTs,
      waMessageId: id,
      status: mapStatus(msg.status),
      mediaKind: media?.kind ?? null,
      mediaMime: media?.mime ?? null,
      mediaName: media?.name ?? null,
      mediaSize: media?.size ?? null,
      mediaSeconds: media?.seconds ?? null,
      mediaPtt: media?.ptt ?? false,
      mediaState: media ? 'pending' : null,
      rawProto: media ? (bridge?.encode(msg) ?? null) : null
    },
    jid,
    lid: isLid(bruto) ? (bruto ?? null) : null,
    direction,
    ts,
    text,
    preview: previewLabel(media, text),
    pushName: msg.pushName ?? null,
    hasMedia: Boolean(media),
    autoDownload: Boolean(media && shouldAutoDownload(media))
  }
}

function afterInsert(one: ParsedMessage, opts: UpsertOptions): void {
  const { jid, direction, ts, text, preview } = one
  const id = one.input.id

  upsertChat(jid, {
    name: direction === 'in' ? one.pushName : null,
    lastMessage: preview,
    lastTs: ts,
    // Guardado para o que sai daqui: o `fetchMessageHistory` manda o `chatJid`
    // verbatim, entao pedir historico pelo telefone numa conversa que o
    // aparelho conhece por LID e mais uma forma de nao receber resposta.
    lid: one.lid
  })

  // Mensagem que entrou de verdade no banco (nao um reenvio do que ja tinhamos).
  // E o unico sinal confiavel de que um pedido de historico trouxe conteudo.
  inboxEvents.emit('inserted', { chatJid: jid, ts })

  let optOut = false
  if (direction === 'in' && !opts.history) {
    incrementUnread(jid)

    // Descadastro pedido pelo contato: respeitar e obrigacao (LGPD) e reduz
    // muito o risco de denuncia. Grava no opt-out GLOBAL, valendo para todas
    // as bases.
    if (text && isOptOutRequest(text)) {
      const phone = jidToE164(jid)
      if (phone) {
        addOptOut(phone, 'respondeu pedido de descadastro')
        saveNow() // decisao de conformidade: nao pode se perder num crash
        optOut = true
        log.warn('opt-out registrado por mensagem do contato', { jid, phone, body: text })
      }
    }

    // CRM: primeira resposta do cliente move o cartao para "em andamento".
    //
    // O instante passado e `Date.now()`, e nao o `ts` da mensagem: a janela
    // anti-resposta-automatica mede milissegundos, e o timestamp do WhatsApp so
    // tem resolucao de segundo e vem de outro relogio. Ver `crm/rules.ts`.
    //
    // So mensagem ao vivo: no historico, uma resposta de meses atras seria
    // processada como se tivesse acabado de chegar — o mesmo motivo pelo qual o
    // opt-out retroativo tambem nao vale aqui.
    // O aviso para o renderer sai por `crmEvents`, dentro de handleInbound.
    handleInbound(jid, Date.now())
  }

  // No historico o evento sai uma vez so, no fim do lote: emitir por mensagem
  // faria o renderer recarregar a lista centenas de vezes seguidas.
  if (!opts.history) inboxEvents.emit('changed', { chatJid: jid, optOut })

  // Anexo de mensagem ANTIGA nao baixa sozinho.
  //
  // Com o historico completo ligado, uma conta antiga traz dezenas de milhares
  // de mensagens de uma vez — baixar cada imagem e audio delas seriam varios GB
  // e horas de rede logo no pareamento. O anexo antigo fica em 'pending' e baixa
  // quando o usuario clica, igual video e documento sempre fizeram.
  if (!opts.history && one.autoDownload) enqueueDownload(id)
}

/**
 * Fila de downloads automaticos.
 *
 * PORQUE UMA FILA: a sincronizacao de historico entrega centenas de mensagens
 * de uma vez. Disparar um download por mensagem abriria centenas de conexoes
 * simultaneas e carregaria tudo na memoria ao mesmo tempo. Duas por vez mantem
 * a conversa preenchendo rapido sem virar uma rajada.
 */
const DOWNLOAD_CONCURRENCY = 2
const downloadQueue: string[] = []
let downloadsInFlight = 0

function enqueueDownload(messageId: string): void {
  downloadQueue.push(messageId)
  pumpDownloads()
}

function pumpDownloads(): void {
  while (downloadsInFlight < DOWNLOAD_CONCURRENCY && downloadQueue.length > 0) {
    const id = downloadQueue.shift()!
    downloadsInFlight += 1
    void downloadMedia(id).finally(() => {
      downloadsInFlight -= 1
      pumpDownloads()
    })
  }
}

/**
 * Baixa (ou rebaixa) o anexo de uma mensagem.
 *
 * Seguro para chamar mais de uma vez: se ja esta baixado ou baixando, sai sem
 * fazer nada — o clique do usuario e o download automatico podem coincidir.
 */
export async function downloadMedia(messageId: string): Promise<boolean> {
  const row = getMessageRow(messageId)
  if (!row || !row.mediaKind) return false
  if (row.mediaState === 'done' && row.mediaPath) return true
  if (row.mediaState === 'downloading') return false
  if (!row.rawProto || !bridge) return false

  setMediaState(messageId, 'downloading')
  inboxEvents.emit('changed', { chatJid: row.chatJid })

  try {
    const { data, mime } = await bridge.download(row.rawProto)
    const path = saveMedia(messageId, data, mime ?? row.mediaMime, row.mediaName)
    setMediaState(messageId, 'done', { path, mime: mime ?? row.mediaMime, size: data.length })
    log.info('anexo baixado', { messageId, kind: row.mediaKind, bytes: data.length })
    return true
  } catch (e) {
    // O WhatsApp expira a URL da midia depois de alguns dias; nesse caso o
    // download falha para sempre e insistir sozinho so gastaria rede.
    setMediaState(messageId, 'error')
    log.warn('falha ao baixar anexo', { messageId, erro: e instanceof Error ? e.message : e })
    return false
  } finally {
    inboxEvents.emit('changed', { chatJid: row.chatJid })
  }
}

/* ── Sincronizacao ───────────────────────────────────────────────────────── */

/** Atualiza o status de entrega (enviado / entregue / lido). */
export function handleMessagesUpdate(
  updates: { key?: { id?: string | null; remoteJid?: string | null }; update?: unknown }[]
): void {
  for (const item of updates) {
    const id = item.key?.id
    if (!id) continue
    const update = item.update as { status?: number | string | null } | undefined
    const status = mapStatus(update?.status)
    if (!status) continue
    if (!advanceMessageStatus(id, status)) continue
    /**
     * O evento precisa citar a conversa CANONICA.
     *
     * A tela filtra por igualdade (`chatJid === active`), entao um `@lid` aqui
     * seria um jid que nao existe em lista nenhuma — o ack de entrega chegaria
     * e a bolha nao mudaria de estado.
     */
    const jid = canonicalJid(item.key?.remoteJid)
    if (jid) inboxEvents.emit('changed', { chatJid: jid })
  }
}

/**
 * Nomes vindos de `contacts.upsert` / `contacts.update`.
 *
 * NAO cria conversa. Isto aqui e a agenda do celular: milhares de numeros que
 * nunca trocaram mensagem. Criar um item de inbox para cada um enchia a lista
 * de conversas vazias — e todas datadas de hoje, porque nao havia mensagem
 * nenhuma para dar a data. Nome sem conversa so serve quando a conversa existe.
 */
export function handleContacts(
  contacts: { id?: string | null; name?: string | null; notify?: string | null }[]
): void {
  withBulkWrite(() => {
    let touched = false
    for (const contact of contacts) {
      if (isIgnorableJid(contact.id)) continue
      // A agenda nao traz `senderPn`: um LID daqui so e traduzivel pelo mapa.
      // Sem traducao o nome iria para uma conversa que nao existe.
      const jid = canonicalJid(contact.id)
      if (!jid) continue
      const name = contact.name || contact.notify
      if (!name) continue
      upsertChat(jid, { name }, { create: false })
      touched = true
    }
    // Um evento so para o lote: a agenda chega com milhares de entradas de uma
    // vez, e um evento por contato faria o renderer recarregar a lista inteira
    // milhares de vezes seguidas.
    if (touched) inboxEvents.emit('changed', { chatJid: '*' })
  })
}

/**
 * Nomes do enum `HistorySync.HistorySyncType` do protocolo.
 *
 * Existe para o log ser legivel: "ON_DEMAND" responde na hora a pergunta que
 * mais custou tempo aqui — o lote que chegou e resposta ao nosso pedido, ou e a
 * sincronizacao inicial que o WhatsApp manda sozinho? Um `6` cru no log nao
 * responde isso para quem esta lendo as 3h da manha.
 */
const HISTORY_SYNC_TYPES = [
  'INITIAL_BOOTSTRAP',
  'INITIAL_STATUS_V3',
  'FULL',
  'RECENT',
  'PUSH_NAME',
  'NON_BLOCKING_DATA',
  'ON_DEMAND'
]

export function historySyncTypeName(t: number | null | undefined): string {
  if (t == null) return 'nao informado'
  return HISTORY_SYNC_TYPES[t] ?? `desconhecido(${t})`
}

/**
 * Os ultimos lotes de historico que chegaram.
 *
 * PORQUE GUARDAR: "o WhatsApp esta mandando historico?" e a pergunta central
 * quando alguem relata que a inbox nao bate com o celular, e ela so era
 * respondivel abrindo o arquivo de log. Aqui vira algo que o usuario consegue
 * copiar e mandar junto com o relato.
 *
 * Guarda CONTAGEM de conversas, nunca os jids: este bloco existe para ser
 * colado num chat de suporte.
 */
export interface HistoryBatchLog {
  at: number
  syncType: string
  requestId: string | null
  messages: number
  inserted: number
  chats: number
  progress: number | null
  isLatest: boolean
}

const BATCH_LOG_LIMIT = 10
let batchLog: HistoryBatchLog[] = []

export function recentHistoryBatches(limit = BATCH_LOG_LIMIT): HistoryBatchLog[] {
  return batchLog.slice(-limit).reverse()
}

/**
 * Sincronizacao de historico (`messaging-history.set`), que o WhatsApp manda
 * logo apos o pareamento e em algumas reconexoes.
 *
 * E o que faz uma conversa antiga deixar de aparecer vazia no app.
 */
export function handleHistorySet(payload: {
  chats?: {
    id?: string | null
    name?: string | null
    conversationTimestamp?: number | Long | null
  }[]
  contacts?: { id?: string | null; name?: string | null; notify?: string | null }[]
  messages?: WaMessageLike[]
  /** 0..100 informado pelo WhatsApp; null nos lotes sob demanda. */
  progress?: number | null
  /** true no ultimo lote da sincronizacao inicial. */
  isLatest?: boolean
  /** Id do pedido sob demanda que gerou este lote (ver `fetchOlderMessages`). */
  peerDataRequestSessionId?: string | null
  /** Enum `HistorySync.HistorySyncType` do protocolo. 6 = ON_DEMAND. */
  syncType?: number | null
}): void {
  /** Quantas mensagens realmente entraram, por conversa. */
  const gravadas = new Map<string, number>()
  const contarGravadas = (p: { chatJid: string }): void => {
    gravadas.set(p.chatJid, (gravadas.get(p.chatJid) ?? 0) + 1)
  }
  inboxEvents.on('inserted', contarGravadas)

  try {
    applyHistorySet(payload)
  } finally {
    inboxEvents.off('inserted', contarGravadas)
  }

  const mensagens = payload.messages?.length ?? 0
  const novas = [...gravadas.values()].reduce((a, b) => a + b, 0)
  /**
   * Os jids do lote, ja canonicalizados.
   *
   * Eles sao o criterio de casamento pedido↔resposta quando o WhatsApp nao
   * preenche o `peerDataRequestSessionId` (ver `historyRequests`). O pedido sai
   * pela conversa canonica, entao o lote tem que falar a mesma lingua — senao
   * uma resposta que chegou seria lida como "o celular nao respondeu".
   */
  const jidsDoLote = [
    ...new Set(
      (payload.messages ?? [])
        .map((m) => canonicalJid(m.key?.remoteJid, { senderPn: m.key?.senderPn }))
        .filter((j): j is string => Boolean(j) && !isIgnorableJid(j))
    )
  ]

  log.info('historico recebido', {
    tipo: historySyncTypeName(payload.syncType),
    conversas: payload.chats?.length ?? 0,
    contatos: payload.contacts?.length ?? 0,
    mensagens,
    novas,
    progresso: payload.progress ?? null,
    ultimoLote: payload.isLatest ?? false,
    respostaDoPedido: payload.peerDataRequestSessionId ?? null,
    // Os jids do lote entram no log porque e por eles que a espera do
    // `historySync` casa pedido e resposta quando o id da sessao vem vazio. Sem
    // isso, "o celular nao respondeu" e "respondeu falando de outra conversa"
    // ficam identicos no log — e sao problemas diferentes.
    jids: jidsDoLote.slice(0, 10),
    maisJids: Math.max(0, jidsDoLote.length - 10)
  })

  batchLog.push({
    at: Date.now(),
    syncType: historySyncTypeName(payload.syncType),
    requestId: payload.peerDataRequestSessionId ?? null,
    messages: mensagens,
    inserted: novas,
    chats: jidsDoLote.length,
    progress: typeof payload.progress === 'number' ? Math.round(payload.progress) : null,
    isLatest: payload.isLatest === true
  })
  if (batchLog.length > BATCH_LOG_LIMIT) batchLog = batchLog.slice(-BATCH_LOG_LIMIT)

  /**
   * O celular RESPONDEU.
   *
   * Quem pediu historico antigo espera por este evento: sem ele so restava
   * esperar um tempo e concluir "acabou o historico" — conclusao errada quando
   * o celular esta offline, e que fazia a conversa ser marcada como completa
   * tendo zero mensagens.
   */
  inboxEvents.emit('historyBatch', {
    requestId: payload.peerDataRequestSessionId ?? null,
    syncType: payload.syncType ?? null,
    // Conversas citadas no lote, com quantas mensagens novas cada uma trouxe.
    inserted: Object.fromEntries(gravadas),
    jids: jidsDoLote
  })

  // O historico completo chega em VARIOS lotes. Sem repassar o progresso, a
  // tela ficaria minutos parecendo que nada acontece — e o usuario concluiria
  // (de novo) que o app nao sincroniza.
  // Fim da sincronizacao inicial: reavalia quem esta na base de leads, agora
  // que as conversas existem. E o flag que a tela usa para focar na base.
  if (payload.isLatest === true) refreshLeadFlags()

  historyState = {
    running: payload.isLatest !== true,
    percent: typeof payload.progress === 'number' ? Math.round(payload.progress) : null,
    messages: historyState.messages + mensagens
  }
  inboxEvents.emit('syncProgress', historyState)

  // Um evento so no fim: o historico chega em lote e emitir por mensagem faria
  // o renderer recarregar a lista centenas de vezes seguidas.
  inboxEvents.emit('changed', { chatJid: '*' })
}

function applyHistorySet(payload: {
  chats?: {
    id?: string | null
    name?: string | null
    conversationTimestamp?: number | Long | null
  }[]
  contacts?: { id?: string | null; name?: string | null; notify?: string | null }[]
  messages?: WaMessageLike[]
}): void {
  withBulkWrite(() => {
    for (const chat of payload.chats ?? []) {
      if (isIgnorableJid(chat.id)) continue
      /**
       * A lista de conversas do lote NAO traz `senderPn`.
       *
       * Um LID daqui so e traduzivel pelo mapa, e sem traducao a conversa nao
       * pode ser criada — seria a duplicata de novo, agora vinda do historico.
       * Quando a varredura por USync resolver o LID, o proximo lote a cria.
       */
      const jid = canonicalJid(chat.id)
      if (!jid) continue
      const ts = toNumber(chat.conversationTimestamp)
      upsertChat(jid, {
        name: chat.name ?? null,
        lid: isLid(chat.id) ? chat.id : null,
        ...(ts ? { lastTs: ts < 1e12 ? ts * 1000 : ts } : {})
      })
    }

    handleContacts(payload.contacts ?? [])
    handleUpsert(payload.messages ?? [], { history: true })

    // Marca ate onde o passado de cada conversa ja foi puxado. E o que permite
    // a tela dizer "sincronizada desde tal data" e o botao de 7/30 dias saber
    // se ainda precisa pedir algo ao WhatsApp.
    for (const jid of new Set(
      (payload.messages ?? [])
        .map((m) => canonicalJid(m.key?.remoteJid, { senderPn: m.key?.senderPn }))
        .filter((j): j is string => Boolean(j))
    )) {
      if (isIgnorableJid(jid)) continue
      const oldest = oldestMessage(jid)
      if (oldest) setChatSync(jid, { syncedFrom: oldest.ts })
    }
  })
}

/* ── Estado da sincronizacao de historico ────────────────────────────────── */

export interface HistorySyncState {
  /** Ha lotes de historico chegando agora. */
  running: boolean
  /** 0..100 quando o WhatsApp informa; null nos pedidos sob demanda. */
  percent: number | null
  /** Mensagens gravadas nesta sessao do app, para a tela mostrar avanco real. */
  messages: number
}

let historyState: HistorySyncState = { running: false, percent: null, messages: 0 }

export function getHistorySyncState(): HistorySyncState {
  return historyState
}

/** Chamado ao (re)conectar: o contador vale por sessao de sincronizacao. */
export function resetHistorySyncState(): void {
  historyState = { running: false, percent: null, messages: 0 }
  inboxEvents.emit('syncProgress', historyState)
}
