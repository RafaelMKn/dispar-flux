import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { getDb, scheduleSave, withBulkWrite } from '../db'
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
    avatarUrl: avatarUrl(row.avatarPath, row.avatarTs),
    isLead: row.isLead === 1,
    syncedFrom: row.syncedFrom,
    syncedFull: row.syncedFull === 1
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

export interface UpsertChatOptions {
  /**
   * Criar a conversa se ela ainda nao existir. Padrao: true.
   *
   * `false` e para quem so tem NOME a oferecer (a agenda do celular, via
   * `contacts.upsert`): a agenda tem milhares de numeros que nunca trocaram
   * mensagem, e cria-los aqui enchia a inbox de conversas vazias — todas com a
   * data de hoje, porque nao ha mensagem nenhuma para datar.
   */
  create?: boolean
}

export function upsertChat(
  jid: string,
  patch: {
    name?: string | null
    lastMessage?: string | null
    lastTs?: number
    /**
     * Endereco de protocolo, quando o servidor endereça esta conversa por LID.
     * `null`/ausente nunca APAGA um lid ja conhecido — a ausencia costuma ser so
     * um caminho que nao tinha essa informacao, nao a prova de que ela mudou.
     */
    lid?: string | null
  },
  opts: UpsertChatOptions = {}
): void {
  const existing = getDb().select().from(chats).where(eq(chats.jid, jid)).get()
  if (existing) {
    // A previa e o carimbo andam JUNTOS: historico antigo chegando depois nao
    // pode puxar a conversa para o topo nem trocar a previa pela mensagem
    // velha. Antes o `lastMessage` era gravado sempre e o `lastTs` so avancava,
    // o que deixava a lista mostrando um texto de meses atras com a data de uma
    // conversa recente.
    const isNewer = (patch.lastTs ?? 0) >= (existing.lastTs ?? 0)
    getDb()
      .update(chats)
      .set({
        // Nao apaga um nome ja conhecido com null.
        name: patch.name ?? existing.name,
        lastMessage: isNewer ? (patch.lastMessage ?? existing.lastMessage) : existing.lastMessage,
        lastTs: Math.max(patch.lastTs ?? 0, existing.lastTs ?? 0) || null,
        lid: patch.lid ?? existing.lid
      })
      .where(eq(chats.jid, jid))
      .run()
  } else {
    if (opts.create === false) return
    getDb()
      .insert(chats)
      .values({
        jid,
        name: patch.name ?? null,
        lastMessage: patch.lastMessage ?? null,
        // NUNCA `Date.now()`: sem mensagem nao existe data, e inventar "agora"
        // era exatamente o que fazia numeros recem-sincronizados aparecerem
        // como se tivessem falado hoje — e, pior, congelava esse carimbo, ja
        // que o update so avanca o `lastTs` (o historico real, mais antigo,
        // nunca conseguia corrigir).
        lastTs: patch.lastTs ?? null,
        unread: 0,
        lid: patch.lid ?? null
      })
      .run()
  }
  scheduleSave()
}

export function getChat(jid: string): ChatRow | undefined {
  return getDb().select().from(chats).where(eq(chats.jid, jid)).get()
}

/**
 * A conversa aberta, para o renderer.
 *
 * Existe separado de `listChats` porque a lista e limitada e filtrada: a
 * conversa aberta pode estar fora dela (aberta pelo kanban, ou escondida pelo
 * filtro da base) e mesmo assim precisa de cabecalho e estado de sincronizacao.
 */
export function getChatView(jid: string): Chat | null {
  const row = getChat(jid)
  return row ? toChat(row) : null
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

/**
 * Quantas conversas a inbox lista por vez.
 *
 * Era 2000, e cada uma delas atravessava o IPC a cada evento da inbox (e a cada
 * 10s do polling) — em conta grande isso e alguns MB de JSON por segundo, com o
 * renderer remontando a lista inteira. 100 e o que cabe na tela com folga; o
 * resto se alcanca pela busca.
 */
export const CHAT_PAGE_SIZE = 100

export interface ListChatsOptions {
  limit?: number
  /** So conversas cujo numero esta na base de leads. */
  onlyLeads?: boolean
  /** Filtra por nome, numero ou previa — feito no SQL, nao no renderer. */
  search?: string
}

export function listChats(opts: ListChatsOptions = {}): Chat[] {
  const limit = opts.limit ?? CHAT_PAGE_SIZE
  const where = [] as ReturnType<typeof eq>[]
  if (opts.onlyLeads) where.push(eq(chats.isLead, 1))

  const term = opts.search?.trim().toLowerCase()
  if (term) {
    const digits = term.replace(/\D/g, '')
    const like = `%${term}%`
    where.push(
      or(
        sql`lower(coalesce(${chats.name}, '')) LIKE ${like}`,
        sql`lower(coalesce(${chats.lastMessage}, '')) LIKE ${like}`,
        digits ? sql`${chats.jid} LIKE ${`%${digits}%`}` : sql`0`
      )!
    )
  }

  return (
    getDb()
      .select()
      .from(chats)
      .where(where.length > 0 ? and(...where) : undefined)
      // Conversa sem nenhuma mensagem (numero da base ainda nao sincronizado) vai
      // para o fim, e nao para o topo como aconteceria com NULL no SQLite.
      .orderBy(sql`coalesce(${chats.lastTs}, 0) DESC`)
      .limit(limit)
      .all()
      .map(toChat)
  )
}

/* ── Base de leads ───────────────────────────────────────────────────────── */

/**
 * Marca quais conversas pertencem a base de leads.
 *
 * O casamento e por sufixo de 8 digitos, e nao por igualdade: o WhatsApp
 * devolve o jid com ou sem o 9o digito dos numeros brasileiros, entao
 * `+5511987654321` na base e `551187654321@s.whatsapp.net` no jid sao a mesma
 * pessoa. E o mesmo criterio ja usado em `checkNumbers`.
 */
export function refreshLeadFlags(): number {
  const jidTail = sql`substr(replace(substr(${chats.jid}, 1, instr(${chats.jid}, '@') - 1), ':', ''), -8)`
  getDb().run(sql`
    UPDATE chats SET is_lead = CASE WHEN
      EXISTS (
        SELECT 1 FROM contacts c
        WHERE c.jid = chats.jid OR substr(replace(c.phone_e164, '+', ''), -8) = ${jidTail}
      ) OR EXISTS (
        SELECT 1 FROM crm_leads l
        WHERE l.jid = chats.jid OR substr(replace(l.phone_e164, '+', ''), -8) = ${jidTail}
      )
    THEN 1 ELSE 0 END
  `)
  scheduleSave()
  return countLeadChats()
}

export function countLeadChats(): number {
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(chats)
      .where(eq(chats.isLead, 1))
      .get()?.n ?? 0
  )
}

/** Ate onde o historico da conversa ja foi puxado, e se acabou. */
export function setChatSync(
  jid: string,
  patch: { syncedFrom?: number | null; syncedFull?: boolean }
): void {
  getDb()
    .update(chats)
    .set({
      ...(patch.syncedFrom !== undefined ? { syncedFrom: patch.syncedFrom } : {}),
      ...(patch.syncedFull !== undefined ? { syncedFull: patch.syncedFull ? 1 : 0 } : {})
    })
    .where(eq(chats.jid, jid))
    .run()
  scheduleSave()
}

/**
 * Conversas da base de leads que ainda nao foram sincronizadas por inteiro.
 *
 * E a fila do "focar na base": quem esta na base tem a conversa completa; o
 * resto da inbox se contenta com a janela recente.
 *
 * So entra quem TEM ancora (ver `oldestAnchor`). Uma conversa que existe apenas
 * porque o disparo escreveu nela nao tem como ser pedida ao celular, e ate aqui
 * ela era marcada como "completa" so para a fila andar — uma mentira que a
 * tirava da fila para sempre. Sem ancora ela simplesmente nao e listada, e
 * volta sozinha quando ganhar a primeira mensagem com carimbo do servidor.
 */
export function leadChatsNeedingFullSync(limit = 50): string[] {
  return getDb()
    .select({ jid: chats.jid })
    .from(chats)
    .where(
      and(
        eq(chats.isLead, 1),
        eq(chats.syncedFull, 0),
        sql`EXISTS (SELECT 1 FROM messages m
                    WHERE m.chat_jid = ${chats.jid}
                      AND m.wa_ts IS NOT NULL
                      AND m.wa_message_id IS NOT NULL)`
      )
    )
    .orderBy(sql`coalesce(${chats.lastTs}, 0) DESC`)
    .limit(limit)
    .all()
    .map((r) => r.jid)
}

/**
 * Realinha o carimbo da conversa com a mensagem mais recente que ela tem.
 *
 * A lista mostrava data de hoje em conversa cujas mensagens sao de meses atras:
 * o `last_ts` era gravado por caminhos que nao vinham de mensagem nenhuma
 * (agenda do celular, lote de historico sem `conversationTimestamp`) e, como o
 * update so avanca o carimbo, a data errada ficava presa para sempre.
 *
 * So mexe em conversa QUE TEM mensagem: ai existe uma verdade para comparar. A
 * conversa sem mensagem e tratada por `clearPhantomChatDates`.
 *
 * Devolve quantas foram corrigidas. Idempotente — roda no boot.
 */
export function repairChatTimestamps(): number {
  const db = getDb()
  const mismatch = sql`EXISTS (SELECT 1 FROM messages m WHERE m.chat_jid = chats.jid)
    AND coalesce(chats.last_ts, -1) <> (SELECT max(m.ts) FROM messages m WHERE m.chat_jid = chats.jid)`

  const broken =
    db
      .select({ n: sql<number>`count(*)` })
      .from(chats)
      .where(mismatch)
      .get()?.n ?? 0
  if (broken === 0) return 0

  withBulkWrite(() => {
    db.run(sql`
      UPDATE chats
      SET last_ts = (SELECT max(m.ts) FROM messages m WHERE m.chat_jid = chats.jid)
      WHERE ${mismatch}
    `)
  })
  return broken
}

/**
 * Desmarca as conversas que foram dadas como "completas" sem prova disso.
 *
 * A primeira versao da sincronizacao sob demanda tratava SILENCIO como fim do
 * historico: se o celular nao respondesse no prazo (desligado, sem internet, com
 * o WhatsApp fechado), a conversa era marcada como completa — muitas vezes com
 * zero mensagens — e saia da fila para sempre. Hoje so o celular respondendo
 * "nao ha mais nada" marca isso, mas os registros errados ja gravados precisam
 * ser desfeitos; no maximo o app pergunta de novo.
 *
 * Devolve quantas foram desmarcadas.
 */
export function clearUnprovenFullSync(): number {
  const db = getDb()
  const marcadas =
    db
      .select({ n: sql<number>`count(*)` })
      .from(chats)
      .where(eq(chats.syncedFull, 1))
      .get()?.n ?? 0
  if (marcadas === 0) return 0

  withBulkWrite(() => {
    db.run(sql`UPDATE chats SET synced_full = 0 WHERE synced_full = 1`)
  })
  return marcadas
}

/**
 * Apaga a data inventada das conversas que nunca tiveram mensagem.
 *
 * Versoes anteriores criavam a conversa com `last_ts = Date.now()` — inclusive
 * para os milhares de numeros da agenda do celular, que nunca trocaram uma
 * mensagem. O resultado era a inbox inteira carimbada com a data de hoje. Sem
 * mensagem nao ha data: a conversa passa a aparecer como nao sincronizada e
 * ganha data de verdade quando o historico dela chegar.
 *
 * Roda UMA VEZ (o chamador guarda o marcador): daqui para a frente o
 * `conversationTimestamp` legitimo de uma conversa ainda nao sincronizada e
 * informacao boa e nao deve ser descartada a cada boot.
 */
export function clearPhantomChatDates(): number {
  const db = getDb()
  const empty = sql`NOT EXISTS (SELECT 1 FROM messages m WHERE m.chat_jid = chats.jid)
    AND (chats.last_ts IS NOT NULL OR chats.last_message IS NOT NULL)`

  const affected =
    db
      .select({ n: sql<number>`count(*)` })
      .from(chats)
      .where(empty)
      .get()?.n ?? 0
  if (affected === 0) return 0

  withBulkWrite(() => {
    db.run(sql`UPDATE chats SET last_ts = NULL, last_message = NULL WHERE ${empty}`)
  })
  return affected
}

export function totalUnread(): number {
  return (
    getDb()
      .select({ n: sql<number>`coalesce(sum(unread), 0)` })
      .from(chats)
      .get()?.n ?? 0
  )
}

/** Totais do banco. Usados no diagnostico: dimensionam o que o app ja recebeu. */
export function countChats(): number {
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(chats)
      .get()?.n ?? 0
  )
}

export function countAllMessages(): number {
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(messages)
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
  /**
   * Carimbo do servidor em ms, ou null quando o `ts` veio do nosso relogio.
   *
   * So quem recebe a mensagem do Baileys tem esse valor. Quem grava o proprio
   * envio na hora (`recordOutgoing`) deixa null e espera o eco corrigir.
   */
  waTs?: number | null
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

function toRow(m: InsertMessageInput): typeof messages.$inferInsert {
  return {
    id: m.id,
    chatJid: m.chatJid,
    direction: m.direction,
    body: m.body,
    ts: m.ts,
    waTs: m.waTs ?? null,
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
  }
}

/**
 * Adota o carimbo do servidor numa linha que ja existe sem ele.
 *
 * O app grava o proprio envio na hora, com o relogio da maquina, porque esperar
 * o eco do Baileys deixaria a mensagem alguns segundos sumida da tela. O eco
 * chega depois com o carimbo de verdade — e ate aqui era simplesmente
 * descartado pela idempotencia, deixando o `ts` fabricado para sempre. Isso
 * quebrava o pedido de historico antigo: a ancora ia com um timestamp que o
 * celular nao conhece, e o aparelho nao respondia nada.
 *
 * NAO passa por `afterInsert`: aquilo incrementa nao-lidas, grava opt-out de
 * LGPD e mexe no CRM. Isto aqui e so a correcao de um carimbo.
 */
function adoptServerStamp(m: InsertMessageInput): void {
  getDb()
    .update(messages)
    .set({ ts: m.ts, waTs: m.waTs, waMessageId: m.waMessageId })
    .where(and(eq(messages.id, m.id), isNull(messages.waTs)))
    .run()
}

/** true se a mensagem foi inserida; false se ja existia (idempotencia). */
export function insertMessage(m: InsertMessageInput): boolean {
  const exists = getDb()
    .select({ id: messages.id, waTs: messages.waTs })
    .from(messages)
    .where(eq(messages.id, m.id))
    .get()
  if (exists) {
    if (exists.waTs == null && m.waTs != null) {
      adoptServerStamp(m)
      scheduleSave()
    }
    return false
  }

  getDb().insert(messages).values(toRow(m)).run()
  scheduleSave()
  return true
}

/**
 * Insere um lote de mensagens, devolvendo so as que eram novas.
 *
 * PORQUE EXISTE: a sincronizacao de historico entrega milhares de mensagens de
 * uma vez, e uma via `insertMessage` custava um SELECT + um INSERT + um agendar
 * gravacao POR MENSAGEM — com o `saveNow` exportando o banco inteiro no meio.
 * Era a maior fonte de travamento do app. Aqui e um SELECT para o lote todo e
 * um INSERT de varias linhas, tudo dentro de um `withBulkWrite`.
 */
export function insertMessages(rows: InsertMessageInput[]): InsertMessageInput[] {
  if (rows.length === 0) return []

  // O proprio lote pode repetir um id (o Baileys reemite).
  const unique = new Map<string, InsertMessageInput>()
  for (const m of rows) unique.set(m.id, m)
  const ids = [...unique.keys()]

  // Alem de "ja conheco este id", o lookup traz o carimbo do servidor: e ele
  // que diz se a linha existente ainda precisa ser corrigida pelo eco.
  const known = new Map<string, number | null>()
  const LOOKUP_CHUNK = 400
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    for (const r of getDb()
      .select({ id: messages.id, waTs: messages.waTs })
      .from(messages)
      .where(inArray(messages.id, ids.slice(i, i + LOOKUP_CHUNK)))
      .all()) {
      known.set(r.id, r.waTs)
    }
  }

  const fresh: InsertMessageInput[] = []
  /**
   * Linhas que ja existiam com carimbo local e agora ganharam o do servidor.
   *
   * Ficam FORA do retorno de proposito: o chamador roda `afterInsert` no que
   * volta daqui, e aquilo tem efeito colateral nao idempotente (nao-lidas,
   * opt-out, CRM, download de midia). Isto e correcao de carimbo, nao mensagem
   * nova — e emitir 'inserted' aqui ainda faria um lote de historico casar com
   * um pedido que ele nao respondeu.
   */
  const corrigir: InsertMessageInput[] = []
  for (const m of unique.values()) {
    if (!known.has(m.id)) fresh.push(m)
    else if (known.get(m.id) == null && m.waTs != null) corrigir.push(m)
  }
  if (fresh.length === 0 && corrigir.length === 0) return []

  withBulkWrite(() => {
    // Lotes pequenos: o sql.js monta a query inteira em memoria (mesma razao do
    // CHUNK na importacao de contatos), e mensagem com midia carrega o protobuf.
    const INSERT_CHUNK = 100
    for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
      getDb()
        .insert(messages)
        .values(fresh.slice(i, i + INSERT_CHUNK).map(toRow))
        .run()
    }
    // Um UPDATE por linha, e nao um lote: `corrigir` so tem o que o proprio app
    // gravou na hora do envio (unidades por lote), enquanto `fresh` tem os
    // milhares do historico. Otimizar aqui seria complicar o que nao pesa.
    for (const m of corrigir) adoptServerStamp(m)
    scheduleSave()
  })
  return fresh
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

/**
 * As ultimas `limit` mensagens da conversa, em ordem cronologica.
 *
 * A tela cresce o `limit` conforme o usuario rola para cima, em vez de usar
 * cursor: a conversa e sempre lida do fim para o comeco, e um limite crescente
 * sobrevive ao recarregamento periodico sem perder o que ja foi carregado —
 * com cursor, cada refresh teria de remontar a janela.
 */
export function listMessages(chatJid: string, limit = 50): Message[] {
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

/** Quantas mensagens a conversa tem no banco. Diz se ainda ha o que carregar. */
export function countMessages(chatJid: string): number {
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.chatJid, chatJid))
      .get()?.n ?? 0
  )
}

/**
 * A mensagem mais antiga da conversa, do jeito que ela aparece na tela.
 *
 * Serve para o bookkeeping de "ate onde ja puxei" (`syncedFrom`), onde a
 * resposta certa e a linha mais antiga DE VERDADE, com carimbo do servidor ou
 * nao. Para pedir historico ao celular use `oldestAnchor`.
 */
export function oldestMessage(
  chatJid: string
): { id: string; remoteJid: string; fromMe: boolean; ts: number } | null {
  const row = getDb()
    .select({ id: messages.id, direction: messages.direction, ts: messages.ts })
    .from(messages)
    .where(eq(messages.chatJid, chatJid))
    .orderBy(asc(messages.ts))
    .limit(1)
    .get()
  if (!row) return null
  return { id: row.id, remoteJid: chatJid, fromMe: row.direction === 'out', ts: row.ts }
}

/** Ancora de um pedido de historico: a tupla que o celular precisa resolver. */
export interface HistoryAnchor {
  id: string
  remoteJid: string
  fromMe: boolean
  ts: number
}

/**
 * A mensagem mais antiga que o CELULAR consegue localizar.
 *
 * O `fetchMessageHistory` pede "o que veio antes desta" pela tupla
 * (chatJid, oldestMsgId, oldestMsgFromMe, oldestMsgTimestampMs). Quando essa
 * tupla nao resolve no aparelho, ele **nao responde nada** — nem erro, nem lote
 * vazio — e o app ficava 45s esperando e concluindo "celular offline".
 *
 * Por isso as duas condicoes sao estruturais, e nao uma convencao a lembrar:
 *
 * - `wa_ts NOT NULL`: carimbo do servidor. O `ts` de uma mensagem que o proprio
 *   app gravou no envio e o relogio da maquina, que o celular nunca viu.
 * - `wa_message_id NOT NULL`: id de verdade do WhatsApp. Os ids sinteticos
 *   (`local-...`, `campaign-...`) nao existem em aparelho nenhum.
 *
 * O `id` sai de `wa_message_id`, e nao de `id`, justamente para nenhum id
 * sintetico conseguir chegar ao celular.
 */
export function oldestAnchor(chatJid: string): HistoryAnchor | null {
  const row = getDb()
    .select({
      waMessageId: messages.waMessageId,
      direction: messages.direction,
      waTs: messages.waTs
    })
    .from(messages)
    .where(
      and(eq(messages.chatJid, chatJid), isNotNull(messages.waTs), isNotNull(messages.waMessageId))
    )
    .orderBy(asc(messages.waTs))
    .limit(1)
    .get()
  if (!row?.waMessageId || row.waTs == null) return null
  return {
    id: row.waMessageId,
    remoteJid: chatJid,
    fromMe: row.direction === 'out',
    ts: row.waTs
  }
}

/**
 * Preenche `wa_ts` nas linhas antigas em que da para provar a origem.
 *
 * PORQUE ISSO PRECISA EXISTIR: a coluna nasce NULL em todo banco ja existente.
 * Sem backfill, TODA conversa viraria `noAnchor` e o app pararia de sincronizar
 * historico — uma regressao bem pior que o bug que estamos corrigindo.
 *
 * O criterio e uma prova aritmetica, nao um chute: o WhatsApp manda
 * `messageTimestamp` em SEGUNDOS, entao todo carimbo que veio dele termina em
 * `000` depois de virar ms. Um `ts` que nao termina em 000 e, com certeza, do
 * nosso relogio. Na direcao contraria sobra ~1 em 1000 de falso positivo (um
 * `Date.now()` que calhou de cair num segundo redondo); o pior caso e uma
 * ancora com ate 999ms de erro, que o celular nao resolve e o usuario tenta de
 * novo. Nada corrompe.
 *
 * Roda UMA VEZ (o chamador guarda o marcador). Heuristica de migracao e uma
 * coisa — auditavel, com data; regra de runtime seria outra, e e exatamente o
 * tipo de convencao implicita que produziu este bug.
 */
export function backfillServerTimestamps(): number {
  const db = getDb()
  const alvo =
    db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .where(
        and(isNull(messages.waTs), isNotNull(messages.waMessageId), sql`${messages.ts} % 1000 = 0`)
      )
      .get()?.n ?? 0
  if (alvo === 0) return 0

  withBulkWrite(() => {
    db.run(
      sql`UPDATE messages SET wa_ts = ts
          WHERE wa_ts IS NULL AND wa_message_id IS NOT NULL AND ts % 1000 = 0`
    )
  })
  return alvo
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
