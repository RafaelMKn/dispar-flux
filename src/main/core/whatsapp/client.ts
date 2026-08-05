import { app } from 'electron'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import QRCode from 'qrcode'
import type { WASocket } from 'baileys'
import type { MediaKind, WhatsappState, WaCheckResult } from '@shared/types'
import { scoped, pinoAdapter } from '../../logger'
import { getJson, setJson } from '../../settings'
import {
  handleUpsert,
  handleMessagesUpdate,
  handleContacts,
  handleHistorySet,
  setMediaBridge,
  inboxEvents,
  resetHistorySyncState
} from './inbox'
import { chatsNeedingAvatar, setAvatar, unreadIncomingIds } from '../../repos/chats'
import { saveAvatar } from './mediaStore'
import { webmToOggOpus } from './opusOgg'

const log = scoped('whatsapp')

/**
 * O erro de desconexao do Baileys e um Boom, mas `@hapi/boom` nao esta no
 * package.json — so resolvia por ser dependencia transitiva icada do baileys.
 * O typecheck quebraria no dia em que o baileys trocasse isso. Como o unico
 * campo usado e `output.statusCode`, um tipo estrutural resolve sem dependencia.
 */
type BoomLike = { output?: { statusCode?: number } }

/**
 * O `baileys` e um pacote ESM-only e o processo main e empacotado como CJS,
 * entao `require('baileys')` falha com ERR_REQUIRE_ESM no Node 20 do Electron.
 * (O Node 25 do sistema aceita require(esm), o que engana em testes fora do
 * Electron.) A saida e `import()` dinamico, suportado de CJS para ESM.
 */
type BaileysModule = typeof import('baileys')
let baileysMod: BaileysModule | null = null

async function loadBaileys(): Promise<BaileysModule> {
  if (!baileysMod) baileysMod = await import('baileys')
  return baileysMod
}

/**
 * Servico de conexao com o WhatsApp via Baileys.
 *
 * O app E o cliente WhatsApp Web (nao ha servidor intermediario), por isso o
 * envio e o recebimento acontecem neste processo.
 *
 * Auth state: `useMultiFileAuthState` em userData/wa-auth. A doc do Baileys
 * alerta contra usa-lo "em producao" por causa de I/O, mas isso visa servidores
 * com muitas instancias simultaneas; aqui e uma instancia so, com throughput
 * baixo. Guardar as chaves no nosso sql.js seria PIOR: cada atualizacao de
 * chave reescreveria o arquivo inteiro do banco. Ainda assim envolvemos as
 * chaves em `makeCacheableSignalKeyStore`, que reduz muito as leituras.
 *
 * ATENCAO: a pasta wa-auth E a sessao do WhatsApp — trate como segredo.
 */

const AUTH_DIR = () => join(app.getPath('userData'), 'wa-auth')

const MAX_BACKOFF_MS = 60_000

/**
 * Versao do WhatsApp Web anunciada no handshake.
 *
 * PORQUE ISSO EXISTE: o Baileys embute uma versao padrao que envelhece, e o
 * WhatsApp passa a rejeitar o handshake com **405 Method Not Allowed** — antes
 * mesmo de emitir o QR. Fixar uma versao aceita resolve.
 *
 * Deixamos configuravel (settings `wa.version`) porque isso volta a quebrar
 * quando o WhatsApp avanca: da para corrigir sem recompilar o app. A doc do
 * Baileys nao recomenda `fetchLatestBaileysVersion`, por isso fixamos.
 */
type WaVersion = [number, number, number]

/**
 * Fallback usado quando nao da para consultar a versao online (ex.: sem rede).
 * Vem de `fetchLatestBaileysVersion()` em 27/07/2026. A versao embutida no
 * proprio pacote e mais antiga que esta e ja causa 405.
 */
const FALLBACK_WA_VERSION: WaVersion = [2, 3000, 1035194821]

const VERSION_FETCH_TIMEOUT_MS = 8000
/** Revalida a versao no maximo a cada 6h; entre isso usamos o cache. */
const VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** Override manual: se preenchido, tem prioridade sobre tudo (escape hatch). */
export function getWaVersionOverride(): WaVersion | null {
  return getJson<WaVersion | null>('wa.versionOverride', null)
}

export function setWaVersionOverride(v: WaVersion | null): void {
  setJson('wa.versionOverride', v)
}

/**
 * Descobre a versao do WhatsApp Web a anunciar no handshake.
 *
 * PORQUE ISSO E DINAMICO: o WhatsApp rejeita versoes velhas com
 * **405 Method Not Allowed** antes mesmo de emitir o QR. A versao embutida no
 * pacote envelhece, e fixar um numero no codigo apenas adia o problema — foi
 * exatamente o que aconteceu aqui. Entao consultamos a versao atual, com cache
 * e fallback, e mantemos um override manual para emergencias.
 */
async function resolveWaVersion(): Promise<{ version: WaVersion; source: string }> {
  const override = getWaVersionOverride()
  if (override) return { version: override, source: 'override manual' }

  const cached = getJson<{ version: WaVersion; at: number } | null>('wa.versionCache', null)
  if (cached && Date.now() - cached.at < VERSION_CACHE_TTL_MS) {
    return { version: cached.version, source: 'cache' }
  }

  try {
    const { fetchLatestBaileysVersion } = await loadBaileys()
    const fetched = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), VERSION_FETCH_TIMEOUT_MS)
      )
    ])
    const version = fetched.version as WaVersion
    setJson('wa.versionCache', { version, at: Date.now() })
    return { version, source: 'online' }
  } catch (e) {
    log.warn('nao foi possivel consultar a versao do WhatsApp Web', e)
    if (cached) return { version: cached.version, source: 'cache expirado' }
    return { version: FALLBACK_WA_VERSION, source: 'fallback embutido' }
  }
}

/** 405 nao e recuperavel por retry: insistir so aumenta risco de bloqueio. */
const FATAL_CODES = new Set([405])

/**
 * Por quanto tempo uma foto de perfil cacheada vale.
 *
 * Foto de perfil muda pouco e cada revalidacao e uma ida a rede por contato;
 * um dia e curto o bastante para nao ficar desatualizado por semanas e longo o
 * bastante para nao virar trafego constante.
 */
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000

/** Quantas fotos buscamos por rodada, para nao rajar a API depois de conectar. */
const AVATAR_BATCH = 20
const AVATAR_GAP_MS = 400

/**
 * Folga minima entre dois pedidos de historico antigo.
 *
 * Rolar a conversa rapido para cima dispararia varios pedidos seguidos, e
 * rajada de requisicao ao servidor do WhatsApp e o que mais parece automacao.
 * Tres segundos e imperceptivel para quem le a conversa e mantem o trafego com
 * cara de uso humano.
 */
const HISTORY_REQUEST_COOLDOWN_MS = 3000

class WhatsappService extends EventEmitter {
  private sock: WASocket | null = null
  private state: WhatsappState = {
    status: 'disconnected',
    qrDataUrl: null,
    me: null,
    lastError: null
  }
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  // Distingue "usuario pediu para desconectar" de "a conexao caiu sozinha".
  private intentionalClose = false
  private starting = false
  /**
   * A sessao ja completou o pareamento?
   *
   * Usamos `creds.me.id` e NAO `creds.registered`: verificamos que o Baileys
   * 6.7.23 mantem `registered: false` mesmo numa sessao pareada e funcionando.
   * Confiar em `registered` faria o tratamento de 405 apagar uma sessao valida
   * e exigir novo QR sem necessidade.
   */
  private paired = false
  private lastVersion: WaVersion | null = null
  /** Evita duas varreduras de foto de perfil concorrentes (reconexao rapida). */
  private avatarSweepRunning = false
  /** Segura o pedido de historico antigo durante o cooldown (ver constante). */
  private historyRequestInFlight = false

  getState(): WhatsappState {
    return { ...this.state }
  }

  private patch(next: Partial<WhatsappState>): void {
    this.state = { ...this.state, ...next }
    this.emit('state', this.getState())
  }

  /** Socket pronto para enviar, ou null. Usado pelo motor de disparo (Fase 1b). */
  get socket(): WASocket | null {
    return this.state.status === 'connected' ? this.sock : null
  }

  async connect(): Promise<void> {
    if (this.starting) return
    if (this.state.status === 'connected' || this.state.status === 'connecting') return
    this.starting = true
    this.intentionalClose = false
    this.clearReconnectTimer()
    try {
      await this.open()
    } finally {
      this.starting = false
    }
  }

  private async open(): Promise<void> {
    this.patch({ status: 'connecting', lastError: null })

    const {
      default: makeWASocket,
      useMultiFileAuthState,
      makeCacheableSignalKeyStore
    } = await loadBaileys()

    const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR())
    const logger = pinoAdapter('baileys')
    const { version, source } = await resolveWaVersion()
    this.lastVersion = version

    this.paired = Boolean(authState.creds?.me?.id)
    log.info('abrindo socket', {
      version: version.join('.'),
      versionSource: source,
      paired: this.paired
    })

    const sock = makeWASocket({
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger)
      },
      logger,
      version,
      // Identificar-se como Ubuntu/Chrome e mais aceito no handshake do que
      // "Windows", que aparece associado ao 405 nos relatos do Baileys.
      browser: ['Ubuntu', 'Chrome', '120.0.0.0'],
      /**
       * Historico COMPLETO no pareamento.
       *
       * Ficou `false` por muito tempo para o primeiro pareamento nao travar numa
       * conta antiga — mas o efeito colateral era a inbox nunca bater com o
       * celular: o WhatsApp mandava um recorte recente e o resto simplesmente
       * nao existia no app.
       *
       * O custo continua real (conta antiga manda dezenas de milhares de
       * mensagens em varios lotes), e por isso ele foi pago de outras formas:
       * o historico chega em lotes com `progress`, que a tela mostra; o anexo de
       * mensagem antiga NAO baixa sozinho (ver AUTO_DOWNLOAD em inbox.ts); e a
       * gravacao no banco e debounced. O que o WhatsApp ainda nao entregar aqui
       * e buscado sob demanda por `fetchOlderMessages`.
       */
      syncFullHistory: true,
      markOnlineOnConnect: false
    })

    this.sock = sock
    this.installMediaBridge()
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
      void this.onConnectionUpdate(update)
    })

    // Inbox: mensagens recebidas chegam localmente, sem webhook.
    sock.ev.on('messages.upsert', ({ messages: msgs, type }) => {
      try {
        // 'append' e historico antigo sendo sincronizado; 'notify' e o que chega
        // agora. Guardamos os dois para a conversa nao aparecer vazia.
        if (type !== 'notify' && type !== 'append') return
        handleUpsert(msgs as Parameters<typeof handleUpsert>[0], { history: type === 'append' })
      } catch (e) {
        log.error('falha ao processar messages.upsert', e)
      }
    })

    // Acks de entrega/leitura: sem isso o "enviado" nunca vira "lido" na tela.
    sock.ev.on('messages.update', (updates) => {
      try {
        handleMessagesUpdate(updates as Parameters<typeof handleMessagesUpdate>[0])
      } catch (e) {
        log.error('falha ao processar messages.update', e)
      }
    })

    // Nome do contato na agenda: melhor que o pushName para identificar quem e.
    const onContacts = (contacts: unknown): void => {
      try {
        handleContacts(contacts as Parameters<typeof handleContacts>[0])
      } catch (e) {
        log.error('falha ao processar contatos', e)
      }
    }
    sock.ev.on('contacts.upsert', onContacts)
    sock.ev.on('contacts.update', onContacts)

    // Recorte de historico que o WhatsApp manda apos o pareamento.
    sock.ev.on('messaging-history.set', (payload) => {
      try {
        handleHistorySet(payload as Parameters<typeof handleHistorySet>[0])
      } catch (e) {
        log.error('falha ao sincronizar historico', e)
      }
    })
  }

  /**
   * Liga a inbox ao Baileys para serializar e baixar midia.
   *
   * A serializacao e em protobuf, e nao JSON, porque `JSON.stringify` destroi
   * os campos binarios da mensagem (`mediaKey`) — e sem eles o anexo nao
   * descriptografa depois.
   */
  private installMediaBridge(): void {
    setMediaBridge({
      encode: (msg) => {
        try {
          const { proto } = baileysMod ?? {}
          if (!proto) return null
          const bytes = proto.WebMessageInfo.encode(
            msg as Parameters<typeof proto.WebMessageInfo.encode>[0]
          ).finish()
          return Buffer.from(bytes).toString('base64')
        } catch (e) {
          log.warn('nao foi possivel guardar a mensagem para download posterior', e)
          return null
        }
      },
      download: async (raw) => {
        const { proto, downloadMediaMessage } = await loadBaileys()
        const msg = proto.WebMessageInfo.decode(Buffer.from(raw, 'base64'))
        const data = (await downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: pinoAdapter('baileys'),
            // Anexo antigo pode ter saido do servidor; isso pede reenvio ao
            // aparelho do contato em vez de falhar direto.
            reuploadRequest: this.sock!.updateMediaMessage
          }
        )) as Buffer

        const content = msg.message
        const mime =
          content?.imageMessage?.mimetype ??
          content?.videoMessage?.mimetype ??
          content?.audioMessage?.mimetype ??
          content?.documentMessage?.mimetype ??
          content?.stickerMessage?.mimetype ??
          null

        return { data, mime }
      }
    })
  }

  private async onConnectionUpdate(update: {
    connection?: string
    lastDisconnect?: { error?: Error | undefined } | undefined
    qr?: string
  }): Promise<void> {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      // O QR expira e o Baileys emite um novo automaticamente.
      const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
      this.patch({ status: 'pairing', qrDataUrl })
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0
      this.patch({
        status: 'connected',
        qrDataUrl: null,
        lastError: null,
        me: this.sock?.user ? { id: this.sock.user.id, name: this.sock.user.name ?? null } : null
      })
      // O contador de historico vale por conexao: os lotes de
      // `messaging-history.set` comecam a chegar logo depois deste ponto.
      resetHistorySyncState()
      // Fotos de perfil em segundo plano: nada na tela espera por isso.
      void this.refreshAvatars().catch((e: unknown) =>
        log.warn('falha ao atualizar fotos de perfil', e)
      )
      return
    }

    if (connection === 'close') {
      const { DisconnectReason } = await loadBaileys()
      const statusCode = (lastDisconnect?.error as BoomLike | undefined)?.output?.statusCode

      if (this.intentionalClose) {
        this.patch({ status: 'disconnected', qrDataUrl: null, me: null })
        return
      }

      // 401: a sessao foi invalidada (deslogado no celular). Auth nao serve mais.
      if (statusCode === DisconnectReason.loggedOut) {
        await this.clearAuth()
        this.patch({
          status: 'loggedOut',
          qrDataUrl: null,
          me: null,
          lastError: 'Sessao encerrada no WhatsApp. Escaneie um novo QR Code.'
        })
        return
      }

      // 515: o Baileys exige recriar o socket logo apos o pareamento. E esperado.
      if (statusCode === DisconnectReason.restartRequired) {
        log.info('restartRequired (515): recriando o socket')
        await this.open()
        return
      }

      // 405 e afins: retry nao resolve e insistir aumenta risco de bloqueio.
      if (statusCode !== undefined && FATAL_CODES.has(statusCode)) {
        log.error(`handshake rejeitado pelo WhatsApp (${statusCode})`, {
          version: this.lastVersion?.join('.'),
          paired: this.paired
        })
        // Invalida o cache de versao: se a versao usada foi recusada, na proxima
        // tentativa vale consultar de novo em vez de reusar a mesma.
        setJson('wa.versionCache', null)
        // Apaga a auth SO se o pareamento nunca completou: nesse caso as chaves
        // nao servem. Numa sessao ja pareada, apagar custaria um novo QR sem
        // necessidade — o 405 ali e problema de versao, nao de credencial.
        if (!this.paired) await this.clearAuth()
        this.patch({
          status: 'disconnected',
          qrDataUrl: null,
          me: null,
          lastError:
            `O WhatsApp recusou a conexao (codigo ${statusCode}) usando a versao ` +
            `${this.lastVersion?.join('.') ?? 'desconhecida'}. Isso costuma ser versao do ` +
            `WhatsApp Web desatualizada. Nao vamos insistir automaticamente para nao ` +
            `arriscar bloqueio do IP — tente novamente em alguns minutos.`
        })
        return
      }

      this.scheduleReconnect(statusCode)
    }
  }

  private scheduleReconnect(statusCode?: number): void {
    this.reconnectAttempts += 1
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), MAX_BACKOFF_MS)
    this.patch({
      status: 'disconnected',
      lastError: `Conexao caiu (codigo ${statusCode ?? 'desconhecido'}). Reconectando em ${Math.round(delay / 1000)}s...`
    })
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      void this.open()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /** Fecha o socket sem apagar a sessao — reconecta depois sem novo QR. */
  async disconnect(): Promise<void> {
    this.intentionalClose = true
    this.clearReconnectTimer()
    try {
      this.sock?.end(undefined)
    } catch {
      // socket ja estava morto
    }
    this.sock = null
    this.patch({ status: 'disconnected', qrDataUrl: null, me: null, lastError: null })
  }

  /** Encerra a sessao e apaga as credenciais: exige novo QR. */
  async logout(): Promise<void> {
    this.intentionalClose = true
    this.clearReconnectTimer()
    try {
      await this.sock?.logout()
    } catch {
      // se o socket nao esta vivo, seguimos e limpamos localmente
    }
    this.sock = null
    await this.clearAuth()
    this.patch({ status: 'disconnected', qrDataUrl: null, me: null, lastError: null })
  }

  private async clearAuth(): Promise<void> {
    try {
      await rm(AUTH_DIR(), { recursive: true, force: true })
    } catch {
      // pasta pode nao existir
    }
  }

  /**
   * Verifica se numeros existem no WhatsApp.
   *
   * Devolve o `jid` que a API retornar — nunca construimos o jid a mao, porque
   * e justamente isso que resolve o 9o digito dos numeros brasileiros.
   */
  async checkNumbers(phones: string[]): Promise<WaCheckResult[]> {
    const sock = this.socket
    if (!sock) throw new Error('WhatsApp nao esta conectado.')

    const results = await sock.onWhatsApp(...phones)
    return phones.map((phoneE164) => {
      const digits = phoneE164.replace(/\D/g, '')
      const hit = results?.find((r) => {
        const rid = r.jid.split('@')[0].replace(/\D/g, '')
        // o jid retornado pode ter/omitir o 9o digito, entao comparamos por sufixo
        return rid === digits || rid.endsWith(digits.slice(-8))
      })
      return {
        phoneE164,
        exists: Boolean(hit?.exists),
        jid: hit?.exists ? hit.jid : null
      }
    })
  }

  async sendText(jid: string, text: string): Promise<string | null> {
    const sock = this.socket
    if (!sock) throw new Error('WhatsApp nao esta conectado.')
    const sent = await sock.sendMessage(jid, { text })
    return sent?.key?.id ?? null
  }

  /** Envia um arquivo do disco como imagem, video, audio ou documento. */
  async sendMedia(
    jid: string,
    input: { filePath: string; kind: MediaKind; fileName: string; mime: string; caption?: string }
  ): Promise<string | null> {
    const sock = this.socket
    if (!sock) throw new Error('WhatsApp nao esta conectado.')

    const caption = input.caption?.trim() || undefined
    // `url` com caminho local faz o Baileys ler o arquivo em stream, sem
    // carregar um video de 50MB inteiro na memoria.
    const source = { url: input.filePath }

    const content = {
      image: { image: source, caption, mimetype: input.mime },
      video: { video: source, caption, mimetype: input.mime },
      audio: { audio: source, mimetype: input.mime, ptt: false },
      sticker: { sticker: source },
      document: {
        document: source,
        caption,
        mimetype: input.mime,
        fileName: input.fileName
      }
    }[input.kind]

    const sent = await sock.sendMessage(jid, content as Parameters<typeof sock.sendMessage>[1])
    return sent?.key?.id ?? null
  }

  /**
   * Envia uma nota de voz gravada no app.
   *
   * Recebe o WebM/Opus do `MediaRecorder` (unico formato que o Chromium grava)
   * e remuxa para Ogg/Opus, que e o que o WhatsApp exige para `ptt`. Devolve
   * tambem o ogg para guardarmos o mesmo arquivo que o contato recebeu.
   */
  async sendVoice(
    jid: string,
    webm: Buffer,
    seconds: number
  ): Promise<{ waId: string | null; ogg: Buffer }> {
    const sock = this.socket
    if (!sock) throw new Error('WhatsApp nao esta conectado.')

    const ogg = webmToOggOpus(webm)
    const sent = await sock.sendMessage(jid, {
      audio: ogg,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      // Informar a duracao evita o Baileys tentar calcular lendo o arquivo.
      seconds: Math.max(1, Math.round(seconds))
    })
    return { waId: sent?.key?.id ?? null, ogg }
  }

  /**
   * Manda confirmacao de leitura das mensagens recebidas de uma conversa.
   *
   * E o que mantem o app em sincronia com o celular: ler aqui zera o nao-lido
   * la tambem. O contato passa a ver o visto azul — comportamento escolhido no
   * produto, nao um efeito colateral.
   */
  async markReadOnWhatsapp(jid: string): Promise<void> {
    const sock = this.socket
    if (!sock) return
    const ids = unreadIncomingIds(jid)
    if (ids.length === 0) return
    try {
      await sock.readMessages(ids.map((id) => ({ remoteJid: jid, id, fromMe: false })))
    } catch (e) {
      // Confirmacao de leitura e best-effort: falhar aqui nao pode impedir o
      // usuario de ler a conversa.
      log.warn('nao foi possivel enviar confirmacao de leitura', e)
    }
  }

  /* ── Fotos de perfil ──────────────────────────────────────────────────── */

  /**
   * Busca as fotos de perfil vencidas, aos poucos.
   *
   * Roda em segundo plano depois de conectar. O espacamento entre chamadas e
   * proposital: uma rajada de dezenas de requisicoes logo apos o handshake e
   * exatamente o tipo de padrao que chama atencao do anti-spam.
   */
  private async refreshAvatars(): Promise<void> {
    if (this.avatarSweepRunning) return
    this.avatarSweepRunning = true
    try {
      const jids = chatsNeedingAvatar(AVATAR_TTL_MS, AVATAR_BATCH)
      for (const jid of jids) {
        if (!this.socket) break
        await this.fetchAvatar(jid)
        await new Promise((r) => setTimeout(r, AVATAR_GAP_MS))
      }
      if (jids.length > 0) inboxEvents.emit('changed', { chatJid: '*' })
    } finally {
      this.avatarSweepRunning = false
    }
  }

  private async fetchAvatar(jid: string): Promise<void> {
    const sock = this.socket
    if (!sock) return
    try {
      const url = await sock.profilePictureUrl(jid, 'image')
      if (!url) {
        // Sem foto: gravamos assim mesmo para o TTL valer e nao reperguntarmos
        // a cada varredura.
        setAvatar(jid, null)
        return
      }
      const response = await fetch(url)
      if (!response.ok) {
        setAvatar(jid, null)
        return
      }
      const buf = Buffer.from(await response.arrayBuffer())
      setAvatar(jid, saveAvatar(jid, buf, response.headers.get('content-type')))
    } catch {
      // 404 = contato sem foto ou que restringiu quem pode ve-la. E o caso
      // comum, nao um erro: marcamos como "sem foto" e seguimos.
      setAvatar(jid, null)
    }
  }

  /** Reconsulta fotos de perfil agora (usado pelo botao de sincronizar). */
  async resync(): Promise<void> {
    await this.refreshAvatars()
  }

  /**
   * Pede ao WhatsApp as mensagens ANTERIORES a mais antiga que temos.
   *
   * O pedido e assincrono: o servidor responde depois, num
   * `messaging-history.set` com `syncType = ON_DEMAND`, e o mesmo caminho de
   * gravacao do historico normal cuida do resto. Por isso o retorno aqui e so
   * "o pedido saiu", nao "as mensagens chegaram".
   *
   * PACING: uma requisicao por vez e por conversa aberta. Varrer todas as
   * conversas em rajada e exatamente o padrao de trafego que faz o WhatsApp
   * bloquear o numero — o mesmo motivo pelo qual o disparo tem intervalo.
   */
  async fetchOlderMessages(
    oldest: { id: string; remoteJid: string; fromMe: boolean; ts: number },
    count = 50
  ): Promise<boolean> {
    const sock = this.socket
    if (!sock) return false
    if (this.historyRequestInFlight) return false

    this.historyRequestInFlight = true
    try {
      // O WhatsApp espera o timestamp em SEGUNDOS; o banco guarda em ms.
      const seconds = Math.floor(oldest.ts / 1000)
      await sock.fetchMessageHistory(
        count,
        { id: oldest.id, remoteJid: oldest.remoteJid, fromMe: oldest.fromMe },
        seconds
      )
      log.info('historico antigo solicitado', { jid: oldest.remoteJid, count })
      return true
    } catch (e) {
      log.warn('falha ao pedir historico antigo', {
        jid: oldest.remoteJid,
        erro: e instanceof Error ? e.message : e
      })
      return false
    } finally {
      // Uma janelinha de folga antes de aceitar o proximo pedido: o usuario
      // rolando rapido nao pode virar uma rajada de requisicoes.
      setTimeout(() => {
        this.historyRequestInFlight = false
      }, HISTORY_REQUEST_COOLDOWN_MS)
    }
  }

  /** Presenca "digitando", para o envio parecer menos automatizado. */
  async sendTyping(jid: string, ms: number): Promise<void> {
    const sock = this.socket
    if (!sock) return
    try {
      await sock.presenceSubscribe(jid)
      await sock.sendPresenceUpdate('composing', jid)
      await new Promise((r) => setTimeout(r, ms))
      await sock.sendPresenceUpdate('paused', jid)
    } catch {
      // presenca e best-effort; nunca deve abortar um envio
    }
  }
}

export const whatsapp = new WhatsappService()
