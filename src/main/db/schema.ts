import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const contactLists = sqliteTable('contact_lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull()
})

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  listId: text('list_id').notNull(),
  name: text('name'),
  phoneE164: text('phone_e164').notNull(),
  jid: text('jid'),
  extraJson: text('extra_json'),
  waValid: integer('wa_valid'),
  optOut: integer('opt_out').notNull().default(0),
  createdAt: integer('created_at').notNull()
})

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  listId: text('list_id').notNull(),
  mode: text('mode').notNull(), // fixed | rotate | paragraph | ai
  configJson: text('config_json').notNull(),
  delayMinMs: integer('delay_min_ms').notNull(),
  delayMaxMs: integer('delay_max_ms').notNull(),
  restEveryN: integer('rest_every_n').notNull(),
  restDurationMs: integer('rest_duration_ms').notNull(),
  dailyCap: integer('daily_cap').notNull(),
  status: text('status').notNull().default('draft'),
  createdAt: integer('created_at').notNull()
})

export const campaignJobs = sqliteTable('campaign_jobs', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull(),
  contactId: text('contact_id').notNull(),
  renderedText: text('rendered_text'),
  status: text('status').notNull().default('pending'), // pending | sending | sent | failed | skipped
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  waMessageId: text('wa_message_id'),
  sentAt: integer('sent_at')
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value')
})

// Opt-out GLOBAL, por numero. `contacts.opt_out` e por linha, e o mesmo numero
// pode existir em varias bases — descadastrar numa nao protegeria nas outras.
// Esta tabela e a fonte da verdade consultada no momento do envio.
export const optOuts = sqliteTable('opt_outs', {
  phoneE164: text('phone_e164').primaryKey(),
  reason: text('reason'),
  createdAt: integer('created_at').notNull()
})

/* ── Inbox (Fase 2) ─────────────────────────────────────────────────────── */

export const chats = sqliteTable('chats', {
  jid: text('jid').primaryKey(),
  name: text('name'),
  lastMessage: text('last_message'),
  lastTs: integer('last_ts'),
  unread: integer('unread').notNull().default(0),
  // Foto de perfil baixada e cacheada em disco (userData/avatars). Guardamos o
  // caminho local, nao a URL do WhatsApp: a URL expira em poucas horas.
  avatarPath: text('avatar_path'),
  // Quando a foto foi buscada pela ultima vez, para revalidar com TTL sem
  // martelar a API a cada render.
  avatarTs: integer('avatar_ts'),
  /**
   * 1 quando o numero da conversa esta em alguma base de leads (`contacts`) ou
   * e um lead do CRM.
   *
   * E um flag GRAVADO, e nao um join na hora de listar: a lista da inbox e
   * relida a cada evento, e cruzar milhares de conversas com a base a cada
   * leitura era um dos motivos da tela travar. Quem mantem o flag e
   * `refreshLeadFlags`, chamado no boot, apos importar CSV e apos sincronizar.
   */
  isLead: integer('is_lead').notNull().default(0),
  /** Ate que instante (ms) o passado desta conversa ja foi puxado do WhatsApp. */
  syncedFrom: integer('synced_from'),
  /** 1 quando o WhatsApp ja disse que nao ha mais historico antes do que temos. */
  syncedFull: integer('synced_full').notNull().default(0)
})

export const messages = sqliteTable('messages', {
  // id = waMessageId quando existe; garante idempotencia se o Baileys reemitir.
  id: text('id').primaryKey(),
  chatJid: text('chat_jid').notNull(),
  direction: text('direction').notNull(), // 'in' | 'out'
  body: text('body'),
  ts: integer('ts').notNull(),
  waMessageId: text('wa_message_id'),
  status: text('status'), // pending | sent | delivered | read | error
  /* ── Midia ───────────────────────────────────────────────────────────── */
  mediaKind: text('media_kind'), // image | video | audio | document | sticker
  mediaPath: text('media_path'), // caminho local depois de baixado
  mediaMime: text('media_mime'),
  mediaName: text('media_name'), // nome do arquivo (documentos)
  mediaSize: integer('media_size'), // bytes informados pelo WhatsApp
  mediaSeconds: integer('media_seconds'), // duracao de audio/video
  mediaPtt: integer('media_ptt'), // 1 = nota de voz
  mediaState: text('media_state'), // pending | downloading | done | error
  /**
   * Mensagem original do Baileys, serializada em protobuf/base64.
   *
   * Necessaria para baixar a midia depois (video e documento so baixam quando
   * o usuario pede): o download exige as chaves de criptografia que vem dentro
   * dela. Guardamos em protobuf e nao em JSON porque `JSON.stringify` destroi
   * os campos binarios (`mediaKey` viraria `{"0":12,"1":...}`) e o download
   * falharia.
   */
  rawProto: text('raw_proto')
})

/* ── CRM (Fase 4) ───────────────────────────────────────────────────────── */

/**
 * Colunas do kanban, editaveis pelo usuario.
 *
 * `role` e o que liga a automacao ao funil: a coluna 'entry' recebe o lead
 * quando o disparo sai, e a coluna 'active' e para onde ele anda sozinho na
 * primeira resposta. As demais colunas tem role NULL e so mudam na mao. Existe
 * no maximo uma de cada role — quem garante isso e o repo, nao o banco, porque
 * o SQLite nao tem indice unico parcial expressivo o bastante aqui sem
 * complicar o bootstrap.
 */
export const crmStages = sqliteTable('crm_stages', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  role: text('role'), // 'entry' | 'active' | null
  createdAt: integer('created_at').notNull()
})

/**
 * Um lead do CRM: alguem que recebeu (ou vai receber) um disparo.
 *
 * Chaveado por TELEFONE, nao por contato. O mesmo numero pode existir em varias
 * bases — se o lead fosse por linha de `contacts`, a mesma pessoa apareceria
 * duas vezes no kanban e responder numa nao moveria a outra. E a mesma decisao
 * ja tomada em `opt_outs`.
 */
export const crmLeads = sqliteTable('crm_leads', {
  id: text('id').primaryKey(),
  phoneE164: text('phone_e164').notNull(),
  /** Contato que originou o lead. Pode ficar orfao se a base for apagada. */
  contactId: text('contact_id'),
  /** JID confirmado pela API; e por ele que a mensagem recebida acha o lead. */
  jid: text('jid'),
  stageId: text('stage_id').notNull(),
  /** Campanha que enviou a primeira mensagem. */
  campaignId: text('campaign_id'),
  /** Quando a PRIMEIRA mensagem do disparo saiu. Base da janela anti-automatica. */
  firstSentAt: integer('first_sent_at'),
  /** Primeira resposta considerada humana. null = nunca respondeu (alvo do cron). */
  firstReplyAt: integer('first_reply_at'),
  lastInboundAt: integer('last_inbound_at'),
  lastOutboundAt: integer('last_outbound_at'),
  /** Quantos follow-ups automaticos ja foram enviados para este lead. */
  followUps: integer('follow_ups').notNull().default(0),
  lastFollowUpAt: integer('last_follow_up_at'),
  /** Respostas descartadas pela janela anti-automatica. So para diagnostico. */
  ignoredAutoReplies: integer('ignored_auto_replies').notNull().default(0),
  notes: text('notes'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/** Compromisso da agenda: lembrete manual preso a um lead. */
export const crmAppointments = sqliteTable('crm_appointments', {
  id: text('id').primaryKey(),
  leadId: text('lead_id'),
  title: text('title').notNull(),
  notes: text('notes'),
  dueAt: integer('due_at').notNull(),
  done: integer('done').notNull().default(0),
  /** 1 depois de a notificacao do sistema ter sido mostrada (uma vez so). */
  notified: integer('notified').notNull().default(0),
  createdAt: integer('created_at').notNull()
})

/**
 * Regra de follow-up automatico ("cron"): quem nao respondeu em N horas recebe
 * outra mensagem, desde que dentro da janela de horario permitida.
 */
export const crmFollowups = sqliteTable('crm_followups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Base alvo; null = todas. */
  listId: text('list_id'),
  /** Horas sem resposta desde o ultimo envio para o lead. */
  afterHours: integer('after_hours').notNull(),
  mode: text('mode').notNull(), // fixed | rotate
  configJson: text('config_json').notNull(),
  /** Dias da semana permitidos, "0,1,2..." com 0 = domingo. */
  weekdays: text('weekdays').notNull(),
  /** Janela de horario, em minutos desde a meia-noite local. */
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  /** Teto de follow-ups por lead (permite 1o, 2o, 3o degrau). */
  maxFollowUps: integer('max_follow_ups').notNull().default(1),
  enabled: integer('enabled').notNull().default(1),
  lastRunAt: integer('last_run_at'),
  createdAt: integer('created_at').notNull()
})
