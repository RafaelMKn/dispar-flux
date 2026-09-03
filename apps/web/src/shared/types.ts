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

/**
 * Quanto historico a sessao atual consegue receber do WhatsApp.
 *
 * `'legacy'` = pareada por uma versao do app que se anunciava como navegador, e
 * a um navegador o WhatsApp manda so os ultimos ~3 meses. Refazer o pareamento
 * passa a valer ~1 ano. `null` = nao ha sessao.
 *
 * Isto e decidido NO PAREAMENTO e nao muda a cada login, por isso nao ha como
 * corrigir sozinho: so um QR novo renegocia.
 */
export type HistoryPairing = 'full' | 'legacy'

export interface WhatsappState {
  status: WhatsappStatus
  qrDataUrl: string | null
  me: { id: string; name: string | null } | null
  lastError: string | null
  historyPairing: HistoryPairing | null
  /** O usuario ja fechou o aviso de repareamento desta sessao. */
  relinkNoticeDismissed: boolean
  /**
   * O servidor recusou parear este numero como aplicativo de desktop.
   *
   * Quando isso acontece, sugerir "refaca o pareamento para ganhar mais
   * historico" vira conselho falso: o app so consegue parear como navegador, e
   * navegador recebe a janela curta. Ver `pairingProfile`.
   */
  desktopPairingRefused: boolean
}

/**
 * Bloco de diagnostico que o usuario copia e manda junto com o relato.
 *
 * PORQUE EXISTE: os problemas de sincronizacao sao invisiveis sem o arquivo de
 * log — "o WhatsApp esta mandando historico?" e "com que plataforma esta sessao
 * se pareou?" nao tem resposta na tela. Pedir para alguem achar o log em
 * %APPDATA% e ler JSON nao e um pedido razoavel.
 *
 * NAO CARREGA: corpo de mensagem, jid de contato nem material de autenticacao.
 * O numero conectado vai mascarado. Isto e para ser colado num chat de suporte.
 */
export interface WaDiagnostics {
  appVersion: string
  status: WhatsappStatus
  lastError: string | null
  /** Numero conectado, mascarado (`5511****4321`). */
  me: string | null
  waVersion: string | null
  /** De onde veio a versao: online, cache, override manual, fallback. */
  waVersionSource: string | null
  historyPairing: HistoryPairing | null
  pairing: {
    browser: string
    platform: 'desktop' | 'web'
    confirmed: boolean
    at: number
    waVersion: string | null
  } | null
  reconnectAttempts: number
  /** Pedidos de historico esperando a vez na fila de envio. */
  historyQueueDepth: number
  historySync: HistorySyncState
  historyBatches: HistoryBatchLog[]
  historyRequests: HistoryRequestLog[]
  chats: number
  messages: number
  /** Conversas ainda endereçadas por LID que nao sabemos traduzir. */
  lidChats: number
  /** Pares LID -> telefone ja conhecidos. */
  lidMapped: number
  /**
   * Pares aprendidos por CONSULTA nesta sessao.
   *
   * Separado do `lidMapped` de proposito: se ficar em zero com a varredura
   * rodando, o caminho USync nao esta devolvendo LID nenhum nesta versao do
   * Baileys, e a traducao depende so do que vem nas mensagens.
   */
  lidLearned: number
  logPath: string
  waLogLevel: string
}

/** Um lote de `messaging-history.set` que chegou. So contagens, nunca jids. */
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

/** Um pedido de historico sob demanda que saiu daqui. */
export interface HistoryRequestLog {
  requestId: string | null
  sentAt: number
  answeredAt: number | null
  inserted: number
  status: 'aguardando' | 'respondido' | 'expirado'
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
  /** O numero esta em alguma base de leads (ou e um lead do CRM). */
  isLead: boolean
  /** Instante da mensagem mais antiga ja trazida; null = nada sincronizado. */
  syncedFrom: number | null
  /** O WhatsApp ja disse que nao ha mais passado antes do que temos. */
  syncedFull: boolean
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

/** Andamento da sincronizacao de historico com o WhatsApp. */
export interface HistorySyncState {
  /** Ha lotes de historico chegando agora. */
  running: boolean
  /** 0..100 quando o WhatsApp informa; null nos pedidos sob demanda. */
  percent: number | null
  /** Mensagens gravadas desde que o app conectou. */
  messages: number
}

/**
 * Como uma sincronizacao sob demanda TERMINOU.
 *
 * PORQUE E UM TIPO E NAO UM PUNHADO DE BOOLEANOS: a combinacao anterior
 * permitia estados que a tela nao sabia traduzir, e o pior deles — "saiu do
 * laco sem ter pedido nada" — caia justamente na frase de sucesso. Pior ainda,
 * "nao consegui enviar o pedido" e "o celular nao respondeu" acabavam na mesma
 * mensagem, acusando o aparelho de um problema que era daqui. Aqui todo fim de
 * caminho tem nome e o `describeSync` e exaustivo pelo tipo.
 */
export type ChatSyncOutcome =
  /** Alcancou a janela pedida (7/30 dias). */
  | 'reachedTarget'
  /** O celular RESPONDEU e nao ha mais passado nesta conversa. */
  | 'exhausted'
  /** Trouxe mensagens; ainda ha passado alem do que pegamos. */
  | 'fetched'
  /**
   * O pedido saiu e a resposta ainda nao chegou. NAO e erro.
   *
   * Quem responde pedido de historico antigo e o APARELHO pareado, montando e
   * subindo um pacote — pode levar minutos. O pedido continua vivo no registro
   * e o lote e creditado quando chegar, sem novo clique.
   */
  | 'awaitingPhone'
  /**
   * Nao ha ancora: nenhuma mensagem local que o celular consiga localizar.
   *
   * Ou a conversa esta vazia, ou tudo que ela tem foi o proprio app que gravou
   * ao enviar — e essas linhas nao carregam o carimbo nem o id que o aparelho
   * conhece. Ver `oldestAnchor`.
   */
  | 'noAnchor'
  /** O WhatsApp nao estava conectado. */
  | 'offline'
  /** Nao conseguimos ENVIAR o pedido. Problema daqui, nunca do aparelho. */
  | 'requestFailed'
  /** A fila de pedidos nao liberou a vez a tempo. Tambem nao e o aparelho. */
  | 'busy'

/** Resultado de um pedido de historico sob demanda de UMA conversa. */
export interface ChatSyncResult {
  jid: string
  /** Mensagens novas gravadas nesta sincronizacao. */
  fetched: number
  outcome: ChatSyncOutcome
  /** Pedidos desta conversa ainda sem resposta quando esta chamada terminou. */
  pendingRequests: number
}

/** Por que a fila da base de leads parou antes do fim. */
export type LeadSyncStop =
  /** Pedidos enviados, respostas ainda nao chegaram. */
  | 'phoneQuiet'
  /** Nao conseguimos enviar o pedido — problema daqui. */
  | 'requestFailed'
  | 'offline'
  | 'busy'

/** Andamento da sincronizacao completa das conversas da base de leads. */
export interface ChatSyncState {
  running: boolean
  /** Conversas ja concluidas. */
  done: number
  total: number
  /** Conversa sendo sincronizada agora. */
  jid: string | null
  /** Mensagens novas gravadas na rodada. */
  fetched: number
  /**
   * Por que a fila parou, ou null se terminou normalmente / foi cancelada.
   *
   * Substituiu um `stalled: boolean` documentado como "o celular deixou de
   * responder" — que a fila levantava tambem quando o pedido nem tinha saido.
   */
  stoppedReason: LeadSyncStop | null
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

/** Comportamento do app rodando em segundo plano (bandeja do sistema). */
export interface BackgroundSettings {
  /**
   * Fechar a janela esconde o app na bandeja em vez de encerrar, mantendo o
   * disparo em andamento.
   */
  closeToTray: boolean
  /** Subir junto com o sistema, ja minimizado na bandeja. */
  launchAtLogin: boolean
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
  /**
   * A opcao de nao reenviar entra no rascunho junto com o resto: ela some ao
   * trocar de aba, o padrao e `false`, e reenviar para quem ja recebeu e
   * exatamente o erro que ela existe para evitar.
   */
  skipAlreadySent: boolean
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

/* ── CRM ─────────────────────────────────────────────────────────────────── */

/**
 * Papel da coluna na automacao.
 *
 * 'entry'  — onde o lead nasce quando o disparo sai;
 * 'active' — para onde ele anda sozinho na primeira resposta valida;
 * null     — coluna comum, movida so na mao.
 */
export type StageRole = 'entry' | 'active' | null

export interface CrmStage {
  id: string
  name: string
  position: number
  role: StageRole
}

export interface CrmLead {
  id: string
  stageId: string
  phoneE164: string
  contactId: string | null
  jid: string | null
  /** Nome do contato na base, quando existe. */
  name: string | null
  /** Nome da base de origem, para o usuario saber de onde veio o lead. */
  listName: string | null
  campaignId: string | null
  campaignName: string | null
  firstSentAt: number | null
  /** null = nunca respondeu. E este campo que o cron de follow-up procura. */
  firstReplyAt: number | null
  lastInboundAt: number | null
  lastOutboundAt: number | null
  followUps: number
  lastFollowUpAt: number | null
  /** Respostas descartadas pela janela anti-automatica. */
  ignoredAutoReplies: number
  notes: string | null
  /** Descadastrado (opt-out global). O cartao mostra o aviso e o cron pula. */
  optOut: boolean
  unread: number
  createdAt: number
  updatedAt: number
}

export interface CrmBoard {
  stages: CrmStage[]
  leads: CrmLead[]
}

export interface CrmAppointment {
  id: string
  leadId: string | null
  /** Nome (ou telefone) do lead, resolvido para a agenda nao precisar do board. */
  leadName: string | null
  title: string
  notes: string | null
  dueAt: number
  done: boolean
  createdAt: number
}

export interface CrmAppointmentInput {
  leadId: string | null
  title: string
  notes: string | null
  dueAt: number
}

/**
 * Follow-up que o cron ainda vai disparar, projetado a partir das regras
 * ativas. Nao existe no banco: e calculado para a agenda mostrar o que vem.
 */
export interface ScheduledFollowUp {
  ruleId: string
  ruleName: string
  leadId: string
  leadName: string
  phoneE164: string
  /** Quando a regra fica elegivel E a janela de horario permite. */
  dueAt: number
}

/** Follow-up so faz sentido com texto pronto; IA e paragrafo ficam no disparo. */
export type FollowUpMode = 'fixed' | 'rotate'

export interface FollowUpRule {
  id: string
  name: string
  /** null = vale para leads de qualquer base. */
  listId: string | null
  afterHours: number
  mode: FollowUpMode
  config: MessageConfig
  /** Dias permitidos, 0 = domingo. */
  weekdays: number[]
  /** Janela de horario em minutos desde a meia-noite local. */
  startMinute: number
  endMinute: number
  maxFollowUps: number
  enabled: boolean
  lastRunAt: number | null
  createdAt: number
}

export type FollowUpRuleInput = Omit<FollowUpRule, 'id' | 'lastRunAt' | 'createdAt'>

export interface FollowUpPreview {
  /** Leads que a regra pegaria agora, ignorando a janela de horario. */
  eligible: number
  /** Proximo instante em que a janela abre (ou agora, se ja esta aberta). */
  nextWindowAt: number
  /** true se a janela esta aberta neste instante. */
  windowOpen: boolean
}

export interface CrmSettings {
  /**
   * Respostas que chegam ate N ms depois do envio nao contam como resposta do
   * cliente — sao mensagem automatica de ausencia. 0 desliga a regra.
   */
  autoReplyWindowMs: number
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
    /** Fecha o aviso de repareamento sem mexer na conexao. */
    dismissRelinkNotice: () => Promise<void>
    /** Bloco copiavel para o usuario mandar junto com um relato de problema. */
    diagnostics: () => Promise<WaDiagnostics>
    getVersionOverride: () => Promise<[number, number, number] | null>
    /** Valvula de escape para o 405. `null` limpa e volta ao automatico. */
    setVersionOverride: (v: [number, number, number] | null) => Promise<void>
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
    /**
     * Conversas da inbox, ja filtradas e limitadas no main.
     *
     * O teto padrao (100) existe porque esta lista atravessa o IPC a cada
     * evento da inbox: mandar milhares de conversas por evento era o que
     * travava a tela.
     */
    chats: (opts?: { limit?: number; onlyLeads?: boolean; search?: string }) => Promise<Chat[]>
    /** Uma conversa so — a aberta pode estar fora da lista limitada/filtrada. */
    chat: (chatJid: string) => Promise<Chat | null>
    /** Quantas conversas tem numero na base de leads. */
    leadCount: () => Promise<number>
    totalUnread: () => Promise<number>
    /** Ultimas `limit` mensagens da conversa, em ordem cronologica. So banco local. */
    messages: (chatJid: string, limit?: number) => Promise<Message[]>
    /** Quantas mensagens a conversa tem no banco. Diz se ainda ha o que mostrar. */
    count: (chatJid: string) => Promise<number>
    /**
     * Pede ao WhatsApp o historico anterior a mensagem mais antiga que temos.
     *
     * Chamar SO quando o banco local acabou: e requisicao de rede ao servidor
     * do WhatsApp, e rajada dela e o que faz o numero ser bloqueado. As
     * mensagens chegam depois, por `onChanged` — nao no retorno.
     */
    requestOlder: (chatJid: string) => Promise<boolean>
    /**
     * Puxa o historico desta conversa ate `days` atras (null = conversa toda).
     *
     * Diferente de `requestOlder`, que dispara UM pedido e volta: aqui o main
     * repete os pedidos, no ritmo seguro, ate alcancar a janela pedida ou ate o
     * WhatsApp nao ter mais passado. Por isso a promessa demora.
     */
    syncChat: (chatJid: string, days: number | null) => Promise<ChatSyncResult>
    /**
     * Avisa que a conversa foi aberta na tela.
     *
     * O main decide se ela precisa de historico (7 dias, ou 30 para numero da
     * base de leads) e puxa sozinho, uma vez por sessao. `null` = nao precisou.
     */
    opened: (chatJid: string) => Promise<ChatSyncResult | null>
    /** Sincroniza por inteiro as conversas de quem esta na base de leads. */
    syncLeads: (maxChats?: number) => Promise<ChatSyncState>
    /** Interrompe a sincronizacao da base em andamento. */
    cancelLeadSync: () => Promise<void>
    leadSyncState: () => Promise<ChatSyncState>
    onLeadSync: (cb: (s: ChatSyncState) => void) => () => void
    /** Lote de historico creditado depois de a tela ja ter parado de esperar. */
    onHistoryLate: (cb: (p: { chatJid: string; inserted: number }) => void) => () => void
    /** Andamento da sincronizacao de historico. */
    syncState: () => Promise<HistorySyncState>
    onSyncProgress: (cb: (s: HistorySyncState) => void) => () => void
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
  crm: {
    /** Colunas + leads numa chamada so: o kanban precisa dos dois juntos. */
    board: () => Promise<CrmBoard>
    moveLead: (leadId: string, stageId: string) => Promise<void>
    setLeadNotes: (leadId: string, notes: string) => Promise<void>
    /** Tira o lead do CRM. Nao apaga o contato nem a conversa. */
    removeLead: (leadId: string) => Promise<void>
    createStage: (name: string) => Promise<CrmStage>
    renameStage: (id: string, name: string) => Promise<void>
    /** Reordena uma posicao para a esquerda (-1) ou direita (1). */
    moveStage: (id: string, direction: -1 | 1) => Promise<void>
    /** Remove a coluna, levando os leads dela para `moveToId`. */
    removeStage: (id: string, moveToId: string) => Promise<void>
    onChanged: (cb: () => void) => () => void
  }
  agenda: {
    list: (opts?: {
      from?: number
      to?: number
      includeDone?: boolean
    }) => Promise<CrmAppointment[]>
    /** Follow-ups previstos pelas regras ativas, para o calendario. */
    upcomingFollowUps: (limit?: number) => Promise<ScheduledFollowUp[]>
    create: (input: CrmAppointmentInput) => Promise<CrmAppointment>
    update: (id: string, input: CrmAppointmentInput) => Promise<void>
    setDone: (id: string, done: boolean) => Promise<void>
    remove: (id: string) => Promise<void>
  }
  followups: {
    list: () => Promise<FollowUpRule[]>
    create: (input: FollowUpRuleInput) => Promise<FollowUpRule>
    update: (id: string, input: FollowUpRuleInput) => Promise<void>
    setEnabled: (id: string, enabled: boolean) => Promise<void>
    remove: (id: string) => Promise<void>
    /** Quantos leads a regra pegaria e quando a janela abre. */
    preview: (id: string) => Promise<FollowUpPreview>
    /** Roda a regra agora, ignorando a janela de horario. null se nao ha ninguem. */
    runNow: (id: string) => Promise<{ campaignId: string; queued: number } | null>
  }
  settings: {
    getSendingDefaults: () => Promise<SendingDefaults>
    setSendingDefaults: (v: SendingDefaults) => Promise<void>
    getCrm: () => Promise<CrmSettings>
    setCrm: (v: CrmSettings) => Promise<void>
    getAi: () => Promise<AiSettings>
    setAi: (provider: AiSettings['provider'], model: string, apiKey?: string) => Promise<void>
    /** Comportamento em segundo plano (bandeja, iniciar com o sistema). */
    getBackground: () => Promise<BackgroundSettings>
    setBackground: (v: BackgroundSettings) => Promise<void>
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
