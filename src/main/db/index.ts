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
