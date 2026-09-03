-- Dispar Flux - Initial Schema Migration (0001_initial_schema.sql)
-- Defines the 20 core modular monolith tables for self-hosted execution.

-- 1. organizations (Exactly one per installation, ADR 0004 & 0019)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  operational_timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  retention_policy_messages_days INTEGER NOT NULL DEFAULT 365,
  retention_policy_media_days INTEGER NOT NULL DEFAULT 90,
  retention_policy_logs_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. members (Proprietário e Operadores locais, ADR 0006 & 0029)
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'operator')),
  password_hash TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_org ON members(organization_id);

-- 3. authorized_devices (Autorização explícita por dispositivo, ADR 0011 & 0047)
CREATE TABLE IF NOT EXISTS authorized_devices (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  device_identifier TEXT NOT NULL,
  name TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  is_approved INTEGER NOT NULL DEFAULT 0 CHECK (is_approved IN (0, 1)),
  approved_at TEXT,
  approved_by_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_member ON authorized_devices(member_id);
CREATE INDEX IF NOT EXISTS idx_devices_identifier ON authorized_devices(device_identifier);

-- 4. sessions (Sessões com expiração ociosa e absoluta, ADR 0047)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES authorized_devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  last_activity_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

-- 5. access_invites (Convites temporários de uso único, ADR 0018)
CREATE TABLE IF NOT EXISTS access_invites (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'operator')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_org ON access_invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_invites_code ON access_invites(code);

-- 6. messaging_connections (Isolamento por conexão, ADR 0002 & 0005)
CREATE TABLE IF NOT EXISTS messaging_connections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'baileys',
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connecting', 'connected', 'qr_ready')),
  phone_number TEXT,
  jid TEXT,
  is_default INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0, 1)),
  auth_state_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conn_org ON messaging_connections(organization_id);

-- 7. contacts (Contato canônico único por telefone normalizado, ADR 0034 & 0041)
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  normalized_phone TEXT NOT NULL,
  name TEXT,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  last_edited_by_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  last_edited_at TEXT,
  is_opted_out INTEGER NOT NULL DEFAULT 0 CHECK (is_opted_out IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, normalized_phone)
);
CREATE INDEX IF NOT EXISTS idx_contacts_org_phone ON contacts(organization_id, normalized_phone);

-- 8. bases (Bases com procedência e finalidade declaradas, ADR 0036)
CREATE TABLE IF NOT EXISTS bases (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provenance TEXT NOT NULL,
  purpose TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bases_org ON bases(organization_id);

-- 9. base_memberships (Participação e atributos de importação isolados, ADR 0041)
CREATE TABLE IF NOT EXISTS base_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  imported_fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (base_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_base_memberships_base ON base_memberships(base_id);
CREATE INDEX IF NOT EXISTS idx_base_memberships_contact ON base_memberships(contact_id);

-- 10. campaigns (Campanhas com teto de segurança e confirmação, ADR 0027, 0035, 0060)
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE RESTRICT,
  base_id TEXT REFERENCES bases(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'canceled')),
  message_template TEXT NOT NULL,
  pacing_interval_seconds INTEGER NOT NULL DEFAULT 30,
  daily_limit INTEGER NOT NULL DEFAULT 100,
  confirmed_responsibility INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_responsibility IN (0, 1)),
  snapshot_total INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  unknown_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  paused_at TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_conn ON campaigns(connection_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- 11. campaign_jobs (Jobs individuais com snapshot; envios incertos nunca repetidos, ADR 0028)
CREATE TABLE IF NOT EXISTS campaign_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  normalized_phone TEXT NOT NULL,
  rendered_message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'unknown')),
  scheduled_for TEXT,
  sent_at TEXT,
  error_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_campaign ON campaign_jobs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_contact ON campaign_jobs(contact_id);
CREATE INDEX IF NOT EXISTS idx_campaign_jobs_status ON campaign_jobs(status);

-- 12. conversations (Conversa única por Conexão-Contato, ADR 0039)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE RESTRICT,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (connection_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_conn_contact ON conversations(connection_id, contact_id);

-- 13. messages (Mensagens com direção, tipo e status, ADR 0039 & 0042)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  type TEXT NOT NULL CHECK (type IN ('manual', 'automated')),
  kind TEXT NOT NULL CHECK (kind IN ('inbound', 'outbound', 'manual', 'automated')),
  content TEXT,
  media_url TEXT,
  media_type TEXT,
  external_id TEXT,
  sender_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  campaign_job_id TEXT REFERENCES campaign_jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_external ON messages(external_id);

-- 14. funnels (Estrutura de múltiplos funis com etapas, ADR 0037)
CREATE TABLE IF NOT EXISTS funnels (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  stages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_funnels_org ON funnels(organization_id);

-- 15. leads (Lead único por Funil-Contato, ADR 0038)
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  value REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (funnel_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_funnel ON leads(funnel_id);
CREATE INDEX IF NOT EXISTS idx_leads_contact ON leads(contact_id);

-- 16. opt_outs (Opt-out em toda a organização com reautorização rastreável, ADR 0040 & 0045)
CREATE TABLE IF NOT EXISTS opt_outs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  normalized_phone TEXT NOT NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  reason TEXT,
  reauthorized_at TEXT,
  reauthorized_by_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  reauthorization_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opt_outs_org_phone ON opt_outs(organization_id, normalized_phone);

-- 17. suppression_keys (Supressão pseudonimizada com hash HMAC/SHA-256, ADR 0044)
CREATE TABLE IF NOT EXISTS suppression_keys (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hash_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, hash_key)
);
CREATE INDEX IF NOT EXISTS idx_suppression_org_hash ON suppression_keys(organization_id, hash_key);

-- 18. audit_records (Auditoria de ações sem PII nem corpos de mensagem, ADR 0030 & 0050)
CREATE TABLE IF NOT EXISTS audit_records (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('member', 'service_account', 'system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org_timestamp ON audit_records(organization_id, timestamp);

-- 19. service_accounts (Identidade não-humana com tokens e escopos revogáveis, ADR 0024)
CREATE TABLE IF NOT EXISTS service_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_accounts_org ON service_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_service_accounts_token ON service_accounts(token_hash);

-- 20. webhooks (Webhooks com chave de assinatura e eventos, ADR 0024)
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(organization_id);
