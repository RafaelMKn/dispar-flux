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
  unread: integer('unread').notNull().default(0)
})

export const messages = sqliteTable('messages', {
  // id = waMessageId quando existe; garante idempotencia se o Baileys reemitir.
  id: text('id').primaryKey(),
  chatJid: text('chat_jid').notNull(),
  direction: text('direction').notNull(), // 'in' | 'out'
  body: text('body'),
  ts: integer('ts').notNull(),
  waMessageId: text('wa_message_id'),
  status: text('status')
})
