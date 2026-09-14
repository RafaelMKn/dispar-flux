-- Dispar Flux - Blocks A, B, C Schema Migration (0002_blocks_a_b_c_schema.sql)
-- Adds AI Copilot (Block A), Multi-Connection & Maturation (Block B), and Webhooks/MCP (Block C) tables.

-- 1. ai_configs (Configuração de Provedores de IA por Organização - Bloco A)
CREATE TABLE IF NOT EXISTS ai_configs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openai', 'groq', 'ollama')),
  api_key_ciphertext TEXT,
  model_name TEXT NOT NULL,
  system_instructions TEXT,
  operational_rules_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_configs_org ON ai_configs(organization_id);

-- 2. connection_pools (Agrupamento e balanceamento de conexões - Bloco B)
CREATE TABLE IF NOT EXISTS connection_pools (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connection_pools_org ON connection_pools(organization_id);

-- 3. connection_pool_members (Membros do pool de conexões - Bloco B)
CREATE TABLE IF NOT EXISTS connection_pool_members (
  pool_id TEXT NOT NULL REFERENCES connection_pools(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pool_id, connection_id)
);
CREATE INDEX IF NOT EXISTS idx_pool_members_conn ON connection_pool_members(connection_id);

-- 4. maturation_state (Estado de maturação e warm-up de conexões - Bloco B)
CREATE TABLE IF NOT EXISTS maturation_state (
  connection_id TEXT PRIMARY KEY NOT NULL REFERENCES messaging_connections(id) ON DELETE CASCADE,
  current_day INTEGER NOT NULL DEFAULT 1,
  stage TEXT NOT NULL DEFAULT 'birth' CHECK (stage IN ('birth', 'activation', 'expansion', 'consolidation', 'nominal')),
  sent_today INTEGER NOT NULL DEFAULT 0,
  daily_cap INTEGER NOT NULL DEFAULT 0,
  report_count_24h INTEGER NOT NULL DEFAULT 0,
  last_evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 5. webhook_subscriptions (Assinaturas de webhooks de saída - Bloco C)
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_org ON webhook_subscriptions(organization_id);

-- 6. webhook_deliveries (Entregas assíncronas e histórico de tentativas de webhooks - Bloco C)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  response_status INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'success', 'failed')),
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliv_sub ON webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliv_state ON webhook_deliveries(state);
