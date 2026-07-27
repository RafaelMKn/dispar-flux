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

export interface Chat {
  jid: string
  name: string | null
  lastMessage: string | null
  lastTs: number | null
  unread: number
}

export interface Message {
  id: string
  chatJid: string
  direction: MessageDirection
  body: string | null
  ts: number
  waMessageId: string | null
  status: string | null
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

export interface CampaignPlan {
  listId: string
  eligible: number
  skippedInvalid: number
  skippedUnchecked: number
  skippedOptOut: number
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
    plan: (listId: string, mode: MessageMode, config: MessageConfig) => Promise<CampaignPlan>
    start: (input: {
      name: string
      listId: string
      mode: MessageMode
      config: MessageConfig
      pacing: SendingDefaults
    }) => Promise<{ campaignId: string; queued: number }>
    pause: () => Promise<void>
    resume: (campaignId: string) => Promise<void>
    cancel: () => Promise<void>
    progress: (campaignId: string) => Promise<CampaignProgress>
    list: () => Promise<CampaignSummary[]>
    /** Campanha em execucao ou pausada com fila pendente, se houver. */
    active: () => Promise<CampaignProgress | null>
    onProgress: (cb: (p: CampaignProgress) => void) => () => void
    onStopped: (cb: (p: { campaignId: string; reason: string }) => void) => () => void
  }
  inbox: {
    chats: () => Promise<Chat[]>
    totalUnread: () => Promise<number>
    messages: (chatJid: string) => Promise<Message[]>
    send: (chatJid: string, text: string) => Promise<void>
    markRead: (chatJid: string) => Promise<void>
    /** Avisa que houve mudanca (nova mensagem, leitura, opt-out detectado). */
    onChanged: (cb: (p: { chatJid: string; optOut?: boolean }) => void) => () => void
  }
  settings: {
    getSendingDefaults: () => Promise<SendingDefaults>
    setSendingDefaults: (v: SendingDefaults) => Promise<void>
    getAi: () => Promise<AiSettings>
    setAi: (provider: AiSettings['provider'], model: string, apiKey?: string) => Promise<void>
  }
}
