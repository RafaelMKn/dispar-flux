import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256, sha256File } from './crypto.js';
import { packDirectory } from './tar.js';
import type { MigrationManifest } from './types.js';

export const LEGACY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS contact_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  name TEXT,
  phone_e164 TEXT NOT NULL,
  jid TEXT,
  extra_json TEXT,
  wa_valid INTEGER,
  opt_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  list_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  config_json TEXT NOT NULL,
  delay_min_ms INTEGER NOT NULL,
  delay_max_ms INTEGER NOT NULL,
  rest_every_n INTEGER NOT NULL,
  rest_duration_ms INTEGER NOT NULL,
  daily_cap INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_jobs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  rendered_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  wa_message_id TEXT,
  sent_at INTEGER
);

CREATE TABLE IF NOT EXISTS opt_outs (
  phone_e164 TEXT PRIMARY KEY,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message TEXT,
  last_ts INTEGER,
  unread INTEGER NOT NULL DEFAULT 0,
  avatar_path TEXT,
  avatar_ts INTEGER,
  is_lead INTEGER NOT NULL DEFAULT 0,
  synced_from INTEGER,
  synced_full INTEGER NOT NULL DEFAULT 0,
  lid TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_jid TEXT NOT NULL,
  direction TEXT NOT NULL,
  body TEXT,
  ts INTEGER NOT NULL,
  wa_ts INTEGER,
  wa_message_id TEXT,
  status TEXT,
  media_kind TEXT,
  media_path TEXT,
  media_mime TEXT,
  media_name TEXT,
  media_size INTEGER,
  media_seconds INTEGER,
  media_ptt INTEGER,
  media_state TEXT,
  raw_proto TEXT
);

CREATE TABLE IF NOT EXISTS crm_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  role TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_leads (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL,
  contact_id TEXT,
  jid TEXT,
  stage_id TEXT NOT NULL,
  campaign_id TEXT,
  first_sent_at INTEGER,
  first_reply_at INTEGER,
  last_inbound_at INTEGER,
  last_outbound_at INTEGER,
  follow_ups INTEGER NOT NULL DEFAULT 0,
  last_follow_up_at INTEGER,
  ignored_auto_replies INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Initializes a new legacy SQLite database file with the legacy desktop schema.
 */
export function initLegacyDatabase(dbFilePath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const db = new DatabaseSync(dbFilePath);
  db.exec(LEGACY_SCHEMA_SQL);
  return db;
}

export interface LegacyDataSeed {
  lists?: Array<{ id: string; name: string; created_at: number }>;
  contacts?: Array<{
    id: string;
    list_id: string;
    name?: string;
    phone_e164: string;
    jid?: string;
    extra_json?: string;
    wa_valid?: number;
    opt_out?: number;
    created_at: number;
  }>;
  campaigns?: Array<{
    id: string;
    name: string;
    list_id: string;
    mode: string;
    config_json: string;
    delay_min_ms: number;
    delay_max_ms: number;
    rest_every_n: number;
    rest_duration_ms: number;
    daily_cap: number;
    status: string;
    created_at: number;
  }>;
  campaign_jobs?: Array<{
    id: string;
    campaign_id: string;
    contact_id: string;
    rendered_text?: string;
    status: string;
    attempts?: number;
    error?: string;
    wa_message_id?: string;
    sent_at?: number;
  }>;
  opt_outs?: Array<{ phone_e164: string; reason?: string; created_at: number }>;
  chats?: Array<{
    jid: string;
    name?: string;
    last_message?: string;
    last_ts?: number;
    unread?: number;
    avatar_path?: string;
    avatar_ts?: number;
    is_lead?: number;
    synced_from?: number;
    synced_full?: number;
    lid?: string;
  }>;
  messages?: Array<{
    id: string;
    chat_jid: string;
    direction: string;
    body?: string;
    ts: number;
    wa_ts?: number;
    wa_message_id?: string;
    status?: string;
    media_kind?: string;
    media_path?: string;
    media_mime?: string;
    media_name?: string;
    media_size?: number;
    media_seconds?: number;
    media_ptt?: number;
    media_state?: string;
    raw_proto?: string;
  }>;
  crm_stages?: Array<{
    id: string;
    name: string;
    position: number;
    role?: string;
    created_at: number;
  }>;
  crm_leads?: Array<{
    id: string;
    phone_e164: string;
    contact_id?: string;
    jid?: string;
    stage_id: string;
    campaign_id?: string;
    first_sent_at?: number;
    first_reply_at?: number;
    last_inbound_at?: number;
    last_outbound_at?: number;
    follow_ups?: number;
    last_follow_up_at?: number;
    ignored_auto_replies?: number;
    notes?: string;
    created_at: number;
    updated_at: number;
  }>;
}

export interface CreatePackageOptions {
  outputDir: string;
  seedData?: LegacyDataSeed;
  mediaFiles?: Array<{ relativePath: string; content: Buffer | string }>;
  suggestedOperationalTimezone?: string;
  archiveAsTar?: boolean;
}

/**
 * Creates a valid Migration Package matching the legacy desktop application format.
 * (ADR 0008, 0014, 0017).
 */
export function createMigrationPackage(options: CreatePackageOptions): {
  packageDir: string;
  tarPath?: string;
  manifest: MigrationManifest;
} {
  const packageDir = options.outputDir;
  fs.mkdirSync(packageDir, { recursive: true });

  const dbPath = path.join(packageDir, 'legacy.sqlite');
  const db = initLegacyDatabase(dbPath);

  const seed = options.seedData || {};

  // Insert seed data
  if (seed.lists) {
    const stmt = db.prepare('INSERT INTO contact_lists (id, name, created_at) VALUES (?, ?, ?)');
    for (const item of seed.lists) stmt.run(item.id, item.name, item.created_at);
  }
  if (seed.contacts) {
    const stmt = db.prepare(
      'INSERT INTO contacts (id, list_id, name, phone_e164, jid, extra_json, wa_valid, opt_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of seed.contacts) {
      stmt.run(
        item.id,
        item.list_id,
        item.name ?? null,
        item.phone_e164,
        item.jid ?? null,
        item.extra_json ?? null,
        item.wa_valid ?? null,
        item.opt_out ?? 0,
        item.created_at
      );
    }
  }
  if (seed.campaigns) {
    const stmt = db.prepare(
      'INSERT INTO campaigns (id, name, list_id, mode, config_json, delay_min_ms, delay_max_ms, rest_every_n, rest_duration_ms, daily_cap, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of seed.campaigns) {
      stmt.run(
        item.id,
        item.name,
        item.list_id,
        item.mode,
        item.config_json,
        item.delay_min_ms,
        item.delay_max_ms,
        item.rest_every_n,
        item.rest_duration_ms,
        item.daily_cap,
        item.status,
        item.created_at
      );
    }
  }
  if (seed.campaign_jobs) {
    const stmt = db.prepare(
      'INSERT INTO campaign_jobs (id, campaign_id, contact_id, rendered_text, status, attempts, error, wa_message_id, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of seed.campaign_jobs) {
      stmt.run(
        item.id,
        item.campaign_id,
        item.contact_id,
        item.rendered_text ?? null,
        item.status,
        item.attempts ?? 0,
        item.error ?? null,
        item.wa_message_id ?? null,
        item.sent_at ?? null
      );
    }
  }
  if (seed.opt_outs) {
    const stmt = db.prepare('INSERT INTO opt_outs (phone_e164, reason, created_at) VALUES (?, ?, ?)');
    for (const item of seed.opt_outs) stmt.run(item.phone_e164, item.reason ?? null, item.created_at);
  }
  if (seed.chats) {
    const stmt = db.prepare(
      'INSERT INTO chats (jid, name, last_message, last_ts, unread, avatar_path, avatar_ts, is_lead, synced_from, synced_full, lid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of seed.chats) {
      stmt.run(
        item.jid,
        item.name ?? null,
        item.last_message ?? null,
        item.last_ts ?? null,
        item.unread ?? 0,
        item.avatar_path ?? null,
        item.avatar_ts ?? null,
        item.is_lead ?? 0,
        item.synced_from ?? null,
        item.synced_full ?? 0,
        item.lid ?? null
      );
    }
  }
  if (seed.messages) {
    const stmt = db.prepare(
      'INSERT INTO messages (id, chat_jid, direction, body, ts, wa_ts, wa_message_id, status, media_kind, media_path, media_mime, media_name, media_size, media_seconds, media_ptt, media_state, raw_proto) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of seed.messages) {
      stmt.run(
        item.id,
        item.chat_jid,
        item.direction,
        item.body ?? null,
        item.ts,
        item.wa_ts ?? null,
        item.wa_message_id ?? null,
        item.status ?? null,
        item.media_kind ?? null,
        item.media_path ?? null,
        item.media_mime ?? null,
        item.media_name ?? null,
        item.media_size ?? null,
        item.media_seconds ?? null,
        item.media_ptt ?? null,
        item.media_state ?? null,
        item.raw_proto ?? null
      );
    }
  }
  if (seed.crm_stages) {
    const stmt = db.prepare('INSERT INTO crm_stages (id, name, position, role, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const item of seed.crm_stages) stmt.run(item.id, item.name, item.position, item.role ?? null, item.created_at);
  }
  if (seed.crm_leads) {
    const stmt = db.prepare(
      'INSERT INTO crm_leads (id, phone_e164, contact_id, jid, stage_id, campaign_id, first_sent_at, first_reply_at, last_inbound_at, last_outbound_at, follow_ups, last_follow_up_at, ignored_auto_replies, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    for (const item of seed.crm_leads) {
      stmt.run(
        item.id,
        item.phone_e164,
        item.contact_id ?? null,
        item.jid ?? null,
        item.stage_id,
        item.campaign_id ?? null,
        item.first_sent_at ?? null,
        item.first_reply_at ?? null,
        item.last_inbound_at ?? null,
        item.last_outbound_at ?? null,
        item.follow_ups ?? 0,
        item.last_follow_up_at ?? null,
        item.ignored_auto_replies ?? 0,
        item.notes ?? null,
        item.created_at,
        item.updated_at
      );
    }
  }

  // Count entities
  const getCount = (table: string): number => {
    const res = db.prepare(`SELECT count(*) as cnt FROM ${table}`).get() as { cnt: number };
    return Number(res?.cnt || 0);
  };

  const entityCounts = {
    lists: getCount('contact_lists'),
    contacts: getCount('contacts'),
    campaigns: getCount('campaigns'),
    campaignJobs: getCount('campaign_jobs'),
    optOuts: getCount('opt_outs'),
    chats: getCount('chats'),
    messages: getCount('messages'),
    stages: getCount('crm_stages'),
    leads: getCount('crm_leads'),
    mediaFiles: options.mediaFiles?.length ?? 0,
  };

  db.close();

  // Write media files
  const manifestFiles: Array<{ path: string; sha256: string; size: number }> = [];

  const dbStat = fs.statSync(dbPath);
  manifestFiles.push({
    path: 'legacy.sqlite',
    sha256: sha256File(dbPath),
    size: dbStat.size,
  });

  if (options.mediaFiles && options.mediaFiles.length > 0) {
    for (const media of options.mediaFiles) {
      const cleanRel = media.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
      const fullPath = path.join(packageDir, cleanRel);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      const buffer = Buffer.isBuffer(media.content) ? media.content : Buffer.from(media.content);
      fs.writeFileSync(fullPath, buffer);

      manifestFiles.push({
        path: cleanRel,
        sha256: sha256(buffer),
        size: buffer.length,
      });
    }
  }

  const manifest: MigrationManifest = {
    version: '1.0.0',
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceApp: 'dispar-flux-desktop',
    suggestedOperationalTimezone: options.suggestedOperationalTimezone || 'America/Sao_Paulo',
    entityCounts,
    files: manifestFiles,
  };

  const manifestPath = path.join(packageDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  let tarPath: string | undefined;
  if (options.archiveAsTar) {
    tarPath = `${packageDir}.tar`;
    const tarBuf = packDirectory(packageDir);
    fs.writeFileSync(tarPath, tarBuf);
  }

  return { packageDir, tarPath, manifest };
}
