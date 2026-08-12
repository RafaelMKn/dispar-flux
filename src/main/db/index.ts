import initSqlJs, { type Database as SqlJsDb } from 'sql.js'
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js'
import { app } from 'electron'
import { join } from 'node:path'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  renameSync,
  unlinkSync
} from 'node:fs'
import * as schema from './schema'

let _sql: SqlJsDb | null = null
let _db: SQLJsDatabase<typeof schema> | null = null
let _dbPath = ''
let _saveTimer: ReturnType<typeof setTimeout> | null = null

// Bootstrap idempotente. Enquanto o projeto e novo mantemos o schema aqui
// (CREATE TABLE IF NOT EXISTS); ao estabilizar, migrar para drizzle-kit.
const BOOTSTRAP_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS contact_lists (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id          TEXT PRIMARY KEY,
    list_id     TEXT NOT NULL,
    name        TEXT,
    phone_e164  TEXT NOT NULL,
    jid         TEXT,
    extra_json  TEXT,
    wa_valid    INTEGER,
    opt_out     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (list_id) REFERENCES contact_lists(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_list ON contacts(list_id);

  CREATE TABLE IF NOT EXISTS campaigns (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    list_id          TEXT NOT NULL,
    mode             TEXT NOT NULL,
    config_json      TEXT NOT NULL,
    delay_min_ms     INTEGER NOT NULL,
    delay_max_ms     INTEGER NOT NULL,
    rest_every_n     INTEGER NOT NULL,
    rest_duration_ms INTEGER NOT NULL,
    daily_cap        INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'draft',
    created_at       INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaign_jobs (
    id            TEXT PRIMARY KEY,
    campaign_id   TEXT NOT NULL,
    contact_id    TEXT NOT NULL,
    rendered_text TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    attempts      INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    wa_message_id TEXT,
    sent_at       INTEGER,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_campaign ON campaign_jobs(campaign_id, status);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Opt-out GLOBAL por numero (ver comentario em schema.ts): consultado no envio.
  CREATE TABLE IF NOT EXISTS opt_outs (
    phone_e164 TEXT PRIMARY KEY,
    reason     TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_e164);

  -- Inbox (Fase 2)
  CREATE TABLE IF NOT EXISTS chats (
    jid          TEXT PRIMARY KEY,
    name         TEXT,
    last_message TEXT,
    last_ts      INTEGER,
    unread       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    chat_jid      TEXT NOT NULL,
    direction     TEXT NOT NULL,
    body          TEXT,
    ts            INTEGER NOT NULL,
    wa_message_id TEXT,
    status        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_jid, ts);

  -- Mapa LID -> telefone (0.3.2). O WhatsApp esta trocando o endereçamento das
  -- conversas de numero para LID (71700301529149@lid), um identificador opaco.
  -- Sem este mapa a mesma pessoa vira duas conversas. Ver core/whatsapp/lid.ts.
  CREATE TABLE IF NOT EXISTS lid_map (
    lid    TEXT PRIMARY KEY,
    jid    TEXT NOT NULL,
    source TEXT NOT NULL,
    at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lid_map_jid ON lid_map(jid);

  -- CRM (Fase 4)
  CREATE TABLE IF NOT EXISTS crm_stages (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL,
    role       TEXT,
    created_at INTEGER NOT NULL
  );

  -- phone_e164 e UNIQUE de proposito: o lead e a pessoa, nao a linha da base.
  -- O mesmo numero em duas bases tem de ser um cartao so no kanban.
  CREATE TABLE IF NOT EXISTS crm_leads (
    id                   TEXT PRIMARY KEY,
    phone_e164           TEXT NOT NULL UNIQUE,
    contact_id           TEXT,
    jid                  TEXT,
    stage_id             TEXT NOT NULL,
    campaign_id          TEXT,
    first_sent_at        INTEGER,
    first_reply_at       INTEGER,
    last_inbound_at      INTEGER,
    last_outbound_at     INTEGER,
    follow_ups           INTEGER NOT NULL DEFAULT 0,
    last_follow_up_at    INTEGER,
    ignored_auto_replies INTEGER NOT NULL DEFAULT 0,
    notes                TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
  );
  -- O caminho quente e "chegou mensagem deste jid, tem lead?", a cada mensagem.
  CREATE INDEX IF NOT EXISTS idx_crm_leads_jid ON crm_leads(jid);
  CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage_id);

  CREATE TABLE IF NOT EXISTS crm_appointments (
    id         TEXT PRIMARY KEY,
    lead_id    TEXT,
    title      TEXT NOT NULL,
    notes      TEXT,
    due_at     INTEGER NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    notified   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_crm_appointments_due ON crm_appointments(due_at);

  CREATE TABLE IF NOT EXISTS crm_followups (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    list_id        TEXT,
    after_hours    INTEGER NOT NULL,
    mode           TEXT NOT NULL,
    config_json    TEXT NOT NULL,
    weekdays       TEXT NOT NULL,
    start_minute   INTEGER NOT NULL,
    end_minute     INTEGER NOT NULL,
    max_follow_ups INTEGER NOT NULL DEFAULT 1,
    enabled        INTEGER NOT NULL DEFAULT 1,
    last_run_at    INTEGER,
    created_at     INTEGER NOT NULL
  );
`

/**
 * Colunas acrescentadas depois da primeira versao do schema.
 *
 * PORQUE ISSO EXISTE SEPARADO: o bootstrap usa CREATE TABLE IF NOT EXISTS, que
 * nao toca numa tabela ja existente — o banco de quem ja usava o app nunca
 * ganharia coluna nova. A alternativa obvia (declarar a coluna no CREATE **e**
 * num ALTER) mantem duas definicoes que inevitavelmente divergem. Entao a
 * coluna vive SO aqui: no banco novo a tabela nasce sem ela e recebe o mesmo
 * ALTER que o banco antigo. Um caminho so.
 *
 * Regra do SQLite: ALTER TABLE ADD COLUMN nao aceita NOT NULL sem DEFAULT.
 */
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  // Inbox: foto de perfil cacheada em disco.
  { table: 'chats', column: 'avatar_path', ddl: 'avatar_path TEXT' },
  { table: 'chats', column: 'avatar_ts', ddl: 'avatar_ts INTEGER' },
  // Inbox: midia (imagem, video, audio, documento, sticker).
  { table: 'messages', column: 'media_kind', ddl: 'media_kind TEXT' },
  { table: 'messages', column: 'media_path', ddl: 'media_path TEXT' },
  { table: 'messages', column: 'media_mime', ddl: 'media_mime TEXT' },
  { table: 'messages', column: 'media_name', ddl: 'media_name TEXT' },
  { table: 'messages', column: 'media_size', ddl: 'media_size INTEGER' },
  { table: 'messages', column: 'media_seconds', ddl: 'media_seconds INTEGER' },
  { table: 'messages', column: 'media_ptt', ddl: 'media_ptt INTEGER' },
  { table: 'messages', column: 'media_state', ddl: 'media_state TEXT' },
  { table: 'messages', column: 'raw_proto', ddl: 'raw_proto TEXT' },
  // Inbox: 1 quando o numero da conversa esta em alguma base de leads.
  { table: 'chats', column: 'is_lead', ddl: 'is_lead INTEGER NOT NULL DEFAULT 0' },
  // Ate onde (em ms) o historico desta conversa ja foi puxado do WhatsApp.
  { table: 'chats', column: 'synced_from', ddl: 'synced_from INTEGER' },
  // 1 quando a conversa ja foi sincronizada por inteiro (nao ha mais passado).
  { table: 'chats', column: 'synced_full', ddl: 'synced_full INTEGER NOT NULL DEFAULT 0' },
  /**
   * Carimbo do servidor (ver `messages.waTs` no schema).
   *
   * Fica NULL nas linhas ja gravadas: o carimbo real delas se perdeu e nao ha
   * de onde recuperar localmente. Nao ha backfill — NULL e a verdade, e o que
   * mantem essas linhas fora da escolha de ancora.
   */
  { table: 'messages', column: 'wa_ts', ddl: 'wa_ts INTEGER' },
  /**
   * Endereco de protocolo da conversa, quando o WhatsApp a endereça por LID.
   *
   * A conversa e canonicalizada pelo TELEFONE (e a chave `jid`), mas o fio
   * precisa continuar falando o que o servidor fala: o `fetchMessageHistory`
   * manda o `chatJid` verbatim, entao pedir historico com o telefone numa
   * conversa que o aparelho conhece por LID e outra forma de silencio.
   */
  { table: 'chats', column: 'lid', ddl: 'lid TEXT' }
]

/**
 * Indices criados depois da primeira versao do schema.
 *
 * Mesma razao do ADDED_COLUMNS: o bootstrap nao roda de novo no banco de quem
 * ja usava o app. Ordenar a lista de conversas por `last_ts` sem indice varre a
 * tabela inteira a cada leitura — e a lista e relida a cada evento da inbox.
 */
const ADDED_INDEXES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_chats_last_ts ON chats(last_ts)',
  'CREATE INDEX IF NOT EXISTS idx_chats_lead ON chats(is_lead, last_ts)',
  'CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_jid, ts)',
  // Escolha da ancora do pedido de historico: so linhas com carimbo do servidor.
  'CREATE INDEX IF NOT EXISTS idx_messages_anchor ON messages(chat_jid, wa_ts)'
]

/** Acrescenta as colunas de `ADDED_COLUMNS` que ainda nao existem. Idempotente. */
export function migrateColumns(sql: SqlJsDb): void {
  const cache = new Map<string, Set<string>>()
  const columnsOf = (table: string): Set<string> => {
    let set = cache.get(table)
    if (!set) {
      const info = sql.exec(`PRAGMA table_info(${table})`)
      // values = [cid, name, type, notnull, dflt_value, pk]
      set = new Set((info[0]?.values ?? []).map((row) => String(row[1])))
      cache.set(table, set)
    }
    return set
  }

  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const existing = columnsOf(table)
    if (existing.has(column)) continue
    sql.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    existing.add(column)
  }

  for (const ddl of ADDED_INDEXES) sql.run(ddl)
}

/** Quantas copias de seguranca guardamos (`.bak.1` e a mais recente). */
export const BACKUP_KEEP = 3

/**
 * Copia o banco para `.bak.1` antes de abri-lo, rotacionando as anteriores.
 *
 * PORQUE ISSO EXISTE: o banco vive INTEIRO em memoria e o `saveNow()` reescreve
 * o arquivo todo a cada gravacao. Nao ha append, nao ha merge — quem salva por
 * ultimo manda. Basta um processo com uma imagem velha em memoria (um build
 * antigo ainda instalado, uma instancia esquecida na bandeja) para dias de
 * trabalho desaparecerem sem nenhum erro, que foi exatamente o que aconteceu
 * com a base de leads em 06/08/2026.
 *
 * A copia e feita na abertura, e nao no fechamento, de proposito: o que se quer
 * preservar e o ultimo estado BOM conhecido. Fechar mal (crash, kill) e
 * justamente quando nao da para confiar em rodar codigo.
 *
 * Best-effort: disco cheio ou arquivo travado nao pode impedir o app de abrir.
 */
export function rotateBackups(dbPath: string): void {
  try {
    if (!existsSync(dbPath)) return // primeira execucao: nada a preservar

    const maisAntiga = `${dbPath}.bak.${BACKUP_KEEP}`
    if (existsSync(maisAntiga)) unlinkSync(maisAntiga)
    for (let i = BACKUP_KEEP - 1; i >= 1; i--) {
      const de = `${dbPath}.bak.${i}`
      if (existsSync(de)) renameSync(de, `${dbPath}.bak.${i + 1}`)
    }
    copyFileSync(dbPath, `${dbPath}.bak.1`)
  } catch {
    // Sem backup e pior que com backup, mas muito melhor que app que nao abre.
  }
}

export async function initDb(): Promise<SQLJsDatabase<typeof schema>> {
  if (_db) return _db

  // sql.js e SQLite compilado em WebAssembly: nao precisa de toolchain nativo.
  // Passamos o binario wasm direto para evitar problemas de path no asar.
  const wasmFile = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const wasmBinary = wasmFile.buffer.slice(
    wasmFile.byteOffset,
    wasmFile.byteOffset + wasmFile.byteLength
  )
  const SQL = await initSqlJs({ wasmBinary })

  _dbPath = join(app.getPath('userData'), 'dispar-flux.sqlite')
  rotateBackups(_dbPath)
  const initial = existsSync(_dbPath) ? new Uint8Array(readFileSync(_dbPath)) : undefined
  _sql = new SQL.Database(initial)
  _sql.exec(BOOTSTRAP_SQL)
  migrateColumns(_sql)

  _db = drizzle(_sql, { schema })
  saveNow() // garante que o arquivo exista
  return _db
}

export function getDb(): SQLJsDatabase<typeof schema> {
  if (!_db) throw new Error('DB nao inicializado. Chame initDb() no app.whenReady().')
  return _db
}

// sql.js mantem o banco em memoria; persistimos exportando os bytes para disco.
export function saveNow(): void {
  if (!_sql) return
  writeFileSync(_dbPath, Buffer.from(_sql.export()))
}

// Salva de forma debounced apos mutacoes (evita reescrever o arquivo a cada linha).
export function scheduleSave(): void {
  // Dentro de um lote, gravar so no fim: o `saveNow` exporta o BANCO INTEIRO
  // para o disco, e fazer isso no meio de milhares de inserts e o que travava
  // o app durante a sincronizacao de historico.
  if (_bulkDepth > 0) {
    _bulkDirty = true
    return
  }
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(saveNow, 250)
}

let _bulkDepth = 0
let _bulkDirty = false

/**
 * Roda `fn` em modo lote: nenhuma gravacao em disco no meio, uma so no fim.
 *
 * Usado pelos caminhos que escrevem muitas linhas de uma vez (sincronizacao de
 * historico, importacao). Reentrante — so o lote mais externo grava.
 */
export function withBulkWrite<T>(fn: () => T): T {
  _bulkDepth += 1
  try {
    return fn()
  } finally {
    _bulkDepth -= 1
    if (_bulkDepth === 0 && _bulkDirty) {
      _bulkDirty = false
      scheduleSave()
    }
  }
}

export { schema }
