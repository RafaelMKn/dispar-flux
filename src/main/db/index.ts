import initSqlJs, { type Database as SqlJsDb } from 'sql.js'
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js'
import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
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
  { table: 'messages', column: 'raw_proto', ddl: 'raw_proto TEXT' }
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
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(saveNow, 250)
}

export { schema }
