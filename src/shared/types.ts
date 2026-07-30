// Tipos compartilhados entre o processo main e o renderer.

export type MessageMode = 'fixed' | 'rotate' | 'paragraph' | 'ai'

// 'unknown': o processo caiu enquanto o job estava em 'sending', entao nao sabemos
// se a mensagem chegou. NUNCA reenviar automaticamente — duplicata e o que mais
// gera denuncia/banimento. Fica para decisao manual do usuario.
export type JobStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'unknown'

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done' | 'canceled'

/* ── WhatsApp (Baileys) ──────────────────────────────────────────────────── */

export type WhatsappStatus =
  | 'disconnected'
  | 'connecting'
  | 'pairing' // aguardando o usuario escanear o QR
  | 'connected'
  | 'loggedOut' // sessao invalidada: precisa de novo QR

export interface WhatsappState {
  status: WhatsappStatus
  qrDataUrl: string | null
  me: { id: string; name: string | null } | null
  lastError: string | null
}

export interface WaCheckResult {
  phoneE164: string
  exists: boolean
  jid: string | null
}

/* ── Inbox ───────────────────────────────────────────────────────────────── */

export type MessageDirection = 'in' | 'out'

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker'

/**
 * Estado do download do anexo.
 *
 * 'pending' significa que a mensagem chegou com midia mas o conteudo ainda nao
 * foi baixado — o padrao para video e documento, que so baixam quando o usuario
 * pede.
 */
export type MediaState = 'pending' | 'downloading' | 'done' | 'error'

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'error'

export interface Chat {
  jid: string
  name: string | null
  lastMessage: string | null
  lastTs: number | null
  unread: number
  /** URL interna (`disparmedia://`) da foto de perfil cacheada, se houver. */
  avatarUrl: string | null
}

export interface Message {
  id: string
  chatJid: string
  direction: MessageDirection
  body: string | null
  ts: number
  waMessageId: string | null
  status: MessageStatus | null
  /** null quando e mensagem so de texto. */
  mediaKind: MediaKind | null
  mediaState: MediaState | null
  /** URL interna do arquivo local; null enquanto nao foi baixado. */
  mediaUrl: string | null
  mediaMime: string | null
  mediaName: string | null
  mediaSize: number | null
  mediaSeconds: number | null
  /** Nota de voz (gravada no microfone), nao um arquivo de audio qualquer. */
  mediaPtt: boolean
}

/** Arquivo escolhido pelo usuario para enviar. */
export interface PickedAttachment {
  filePath: string
  fileName: string
  mime: string
  size: number
  kind: MediaKind
}

export interface ContactList {
  id: string
  name: string
  createdAt: number
}

export interface Contact {
  id: string
  listId: string
  name: string | null
  phoneE164: string
  jid: string | null
  extraJson: string | null
  waValid: number | null // 0 | 1 | null (nao verificado)
  optOut: number // 0 | 1
  createdAt: number
}

export interface AiSettings {
  provider: 'anthropic' | 'openai' | 'google' | ''
  model: string
  // a chave nunca trafega em texto para o renderer; guardamos so um flag
  hasKey: boolean
}

export interface SendingDefaults {
  delayMinMs: number
  delayMaxMs: number
  restEveryN: number
  restDurationMs: number
  dailyCap: number
}

/** Configuracao da mensagem por modo (so o campo do modo escolhido e usado). */
export interface MessageConfig {
  text?: string // fixed
  messages?: string[] // rotate
  pools?: string[][] // paragraph
  prompt?: string // ai (Fase 3)
}

/** Rascunho da tela Disparo, persistido para sobreviver a troca de aba e reabertura do app. */
export interface CampaignDraft {
  listId: string
  mode: MessageMode
  name: string
  config: MessageConfig
  pacing: SendingDefaults | null
}

export interface CampaignPlan {
  listId: string
  eligible: number
  skippedInvalid: number
  skippedUnchecked: number
  skippedOptOut: number
  /** So contado quando `skipAlreadySent` foi pedido no plano/inicio. */
  skippedAlreadySent: number
  samples: string[]
}

export interface CampaignProgress {
  campaignId: string
  total: number
  sent: number
  failed: number
  skipped: number
  unknown: number
  pending: number
  status: string
}

/** Um job de disparo com dados do contato, para a lista contato-a-contato. */
export interface CampaignJobView {
  id: string
  contactId: string
  contactName: string | null
  phoneE164: string
  status: JobStatus
  renderedText: string | null
  error: string | null
  sentAt: number | null
}

export interface CampaignSummary {
  id: string
  name: string
  listId: string
  mode: string
  status: string
  createdAt: number
}

export type ContactFilter = 'all' | 'valid' | 'invalid' | 'unchecked' | 'optOut'

export interface ContactListStats {
  total: number
  valid: number
  invalid: number
  unchecked: number
  optOut: number
}

/* ── Import de CSV ───────────────────────────────────────────────────────── */

export interface CsvPreview {
  filePath: string
  encoding: 'utf-8' | 'latin1'
  delimiter: string
  headers: string[]
  rows: string[][] // primeiras linhas, para o usuario conferir o mapeamento
  totalRows: number
  /** Mapeamento adivinhado pelos nomes das colunas; o usuario pode ajustar. */
  suggested?: CsvMapping
}

/** Qual coluna do CSV alimenta cada campo. Chave = campo, valor = header do CSV. */
export interface CsvMapping {
  name: string | null
  phone: string | null
  extras: string[]
}

export interface ImportReport {
  imported: number
  invalidPhone: number
  duplicateInFile: number
  alreadyInList: number
  optedOut: number
  samples: { name: string | null; phoneE164: string }[]
}

/* ── Atualizacao automatica ──────────────────────────────────────────────── */

export type UpdateStatus =
  | 'idle' // nenhuma atualizacao pendente
  | 'unsupported' // rodando em dev: nao ha o que atualizar
  | 'checking'
  | 'available' // ha versao nova, aguardando o usuario mandar baixar
  | 'downloading'
  | 'ready' // baixada, aguardando reinicio
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** Versao instalada agora. */
  currentVersion: string
  /** Versao disponivel no GitHub, quando houver. */
  version: string | null
  /** 0..100 durante o download. */
  percent: number
  bytesPerSecond: number | null
  error: string | null
}

// Contrato exposto no window.api (preload).
export interface DisparApi {
  app: {
    version: () => Promise<string>
    ping: () => Promise<string>
  }
  whatsapp: {
    getState: () => Promise<WhatsappState>
    connect: () => Promise<void>
    disconnect: () => Promise<void>
    logout: () => Promise<void>
    /** Assina mudancas de estado. Retorna a funcao de unsubscribe. */
    onState: (cb: (state: WhatsappState) => void) => () => void
  }
  contactLists: {
    list: () => Promise<ContactList[]>
    create: (name: string) => Promise<ContactList>
    remove: (id: string) => Promise<void>
    stats: (id: string) => Promise<ContactListStats>
  }
  contacts: {
    page: (
      listId: string,
      opts: { search?: string; filter?: ContactFilter; offset?: number; limit?: number }
    ) => Promise<{ rows: Contact[]; total: number }>
    /** Colunas extras existentes na base, para montar a tabela completa. */
    extraKeys: (listId: string) => Promise<string[]>
    setOptOut: (contactId: string, optOut: boolean) => Promise<void>
    remove: (contactId: string) => Promise<void>
    /** Valida numeros no WhatsApp em lote, com pacing. Retorna quantos foram checados. */
    validate: (listId: string) => Promise<{ checked: number; valid: number; invalid: number }>
    onValidateProgress: (
      cb: (p: { listId: string; done: number; total: number }) => void
    ) => () => void
  }
  csv: {
    /** Abre o seletor de arquivo e devolve o preview (headers + primeiras linhas). */
    pick: () => Promise<CsvPreview | null>
    /** Confirma a importacao com o mapeamento escolhido. */
    import: (listId: string, preview: CsvPreview, mapping: CsvMapping) => Promise<ImportReport>
    /** Salva um modelo de planilha para o usuario preencher. */
    saveTemplate: () => Promise<string | null>
    /** Exporta os contatos da base como CSV. */
    exportList: (listId: string) => Promise<string | null>
  }
  campaign: {
    /** Previa: quem entra, quem fica de fora e amostras renderizadas. */
    plan: (
      listId: string,
      mode: MessageMode,
      config: MessageConfig,
      skipAlreadySent?: boolean
    ) => Promise<CampaignPlan>
    start: (input: {
      name: string
      listId: string
      mode: MessageMode
      config: MessageConfig
      pacing: SendingDefaults
      /** Nao reenvia para quem ja recebeu mensagem em campanha anterior desta base. */
      skipAlreadySent?: boolean
    }) => Promise<{ campaignId: string; queued: number }>
    pause: () => Promise<void>
    resume: (campaignId: string) => Promise<void>
    cancel: () => Promise<void>
    progress: (campaignId: string) => Promise<CampaignProgress>
    list: () => Promise<CampaignSummary[]>
    /** Campanha em execucao ou pausada com fila pendente, se houver. */
    active: () => Promise<CampaignProgress | null>
    /** Jobs de uma campanha com nome/telefone do contato, para ver quem recebeu e quem nao. */
    jobs: (
      campaignId: string,
      opts?: { status?: JobStatus; limit?: number; offset?: number }
    ) => Promise<{ rows: CampaignJobView[]; total: number }>
    /** Rascunho salvo da tela Disparo (config ainda nao enviada). */
    loadDraft: () => Promise<CampaignDraft | null>
    /** Salva o rascunho atual, ou `null` para limpar. */
    saveDraft: (draft: CampaignDraft | null) => Promise<void>
    onProgress: (cb: (p: CampaignProgress) => void) => () => void
    onStopped: (cb: (p: { campaignId: string; reason: string }) => void) => () => void
  }
  inbox: {
    chats: () => Promise<Chat[]>
    totalUnread: () => Promise<number>
    messages: (chatJid: string) => Promise<Message[]>
    send: (chatJid: string, text: string) => Promise<void>
    markRead: (chatJid: string) => Promise<void>
    /** Abre o seletor de arquivo. `kind` filtra as extensoes oferecidas. */
    pickAttachment: (kind: 'media' | 'document' | 'audio') => Promise<PickedAttachment | null>
    /** Envia um arquivo do disco como imagem, video, audio ou documento. */
    sendMedia: (
      chatJid: string,
      input: { filePath: string; kind: MediaKind; fileName: string; mime: string; caption?: string }
    ) => Promise<void>
    /**
     * Envia uma nota de voz gravada no app. Recebe o WebM/Opus do
     * MediaRecorder em base64; o main converte para Ogg/Opus antes de enviar.
     */
    sendVoice: (chatJid: string, webmBase64: string, seconds: number) => Promise<void>
    /** Baixa sob demanda o anexo de uma mensagem (video/documento). */
    downloadMedia: (messageId: string) => Promise<Message | null>
    /** Abre o anexo no programa padrao do sistema. */
    openMedia: (messageId: string) => Promise<void>
    /** Salva uma copia do anexo onde o usuario escolher. */
    saveMediaAs: (messageId: string) => Promise<string | null>
    /** Reconsulta conversas e fotos de perfil no WhatsApp. */
    resync: () => Promise<void>
    /** Avisa que houve mudanca (nova mensagem, leitura, opt-out detectado). */
    onChanged: (cb: (p: { chatJid: string; optOut?: boolean }) => void) => () => void
  }
  settings: {
    getSendingDefaults: () => Promise<SendingDefaults>
    setSendingDefaults: (v: SendingDefaults) => Promise<void>
    getAi: () => Promise<AiSettings>
    setAi: (provider: AiSettings['provider'], model: string, apiKey?: string) => Promise<void>
  }
  updater: {
    getState: () => Promise<UpdateState>
    /** Consulta o GitHub agora. Nao baixa nada. */
    check: () => Promise<void>
    /** Baixa o instalador da versao disponivel. */
    download: () => Promise<void>
    /** Fecha o app e roda o instalador. */
    install: () => Promise<void>
    onState: (cb: (s: UpdateState) => void) => () => void
  }
}
