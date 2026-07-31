import { safeStorage } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb, scheduleSave } from './db'
import { settings } from './db/schema'
<<<<<<< HEAD
import type { AiSettings, CampaignDraft, SendingDefaults } from '@shared/types'
=======
import type { AiSettings, BackgroundSettings, CampaignDraft, SendingDefaults } from '@shared/types'
>>>>>>> f4de36f

const ENC_PREFIX = 'enc::'

function readRaw(key: string): string | null {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? null
}

function writeRaw(key: string, value: string | null): void {
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
  scheduleSave()
}

// --- Configuracoes simples (JSON em texto claro) ---
export function getJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function setJson<T>(key: string, value: T): void {
  writeRaw(key, JSON.stringify(value))
}

// --- Segredos (criptografados via DPAPI/safeStorage) ---
export function setSecret(key: string, plaintext: string): void {
  if (!plaintext) {
    writeRaw(key, null)
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(plaintext)
    writeRaw(key, ENC_PREFIX + buf.toString('base64'))
  } else {
    // Fallback (nao deveria ocorrer no Windows apos app ready). Guardamos sem
    // prefixo para deixar explicito que nao esta criptografado.
    writeRaw(key, plaintext)
  }
}

export function getSecret(key: string): string | null {
  const raw = readRaw(key)
  if (raw == null) return null
  if (raw.startsWith(ENC_PREFIX)) {
    try {
      const buf = Buffer.from(raw.slice(ENC_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    } catch {
      return null
    }
  }
  return raw
}

export function hasSecret(key: string): boolean {
  return readRaw(key) != null
}

// --- Helpers de dominio ---
export const DEFAULT_SENDING: SendingDefaults = {
  delayMinMs: 8000,
  delayMaxMs: 20000,
  restEveryN: 40,
  restDurationMs: 5 * 60 * 1000,
  dailyCap: 300
}

export function getSendingDefaults(): SendingDefaults {
  return getJson('sending.defaults', DEFAULT_SENDING)
}

export function setSendingDefaults(v: SendingDefaults): void {
  setJson('sending.defaults', v)
}

/**
 * Fechar-para-bandeja vem LIGADO: o motivo de existir a bandeja e nao perder um
 * disparo em andamento por causa de um clique no X. Na primeira vez o app avisa
 * para onde a janela foi — sem isso o usuario acha que fechou e o app fica
 * rodando escondido.
 *
 * Iniciar-com-o-sistema vem DESLIGADO: instalar um app e ele passar a abrir
 * sozinho e intrusivo; quem quer isso liga em Configuracoes.
 */
export const DEFAULT_BACKGROUND: BackgroundSettings = {
  closeToTray: true,
  launchAtLogin: false
}

export function getBackgroundSettings(): BackgroundSettings {
  return { ...DEFAULT_BACKGROUND, ...getJson('background', {}) }
}

export function setBackgroundSettings(v: BackgroundSettings): void {
  setJson('background', v)
}

const TRAY_NOTICE_KEY = 'background.trayNoticeShown'

/** true na primeira vez; usado para explicar a bandeja so uma vez. */
export function shouldShowTrayNotice(): boolean {
  if (getJson(TRAY_NOTICE_KEY, false)) return false
  setJson(TRAY_NOTICE_KEY, true)
  return true
}

const CAMPAIGN_DRAFT_KEY = 'campaign.draft'

/** Rascunho da tela Disparo. `null` quando nao ha nada salvo (ou foi limpo). */
/**
 * O rascunho no banco pode ter sido gravado por uma versao anterior do app, que
 * nao conhecia `skipAlreadySent`. O tipo diz exatamente isso: so esse campo
 * pode faltar.
 */
type SavedDraft = Omit<CampaignDraft, 'skipAlreadySent'> & { skipAlreadySent?: boolean }

export function getCampaignDraft(): CampaignDraft | null {
  const saved = getJson<SavedDraft | null>(CAMPAIGN_DRAFT_KEY, null)
  if (!saved) return null
  // O default vem daqui, e nao da tela, para as duas pontas concordarem sobre o
  // que e um rascunho completo.
  return { ...saved, skipAlreadySent: saved.skipAlreadySent ?? false }
}

export function setCampaignDraft(v: CampaignDraft | null): void {
  setJson(CAMPAIGN_DRAFT_KEY, v)
}

const AI_KEY_SECRET = 'secret.ai.apiKey'

export function getAiSettings(): AiSettings {
  const provider = getJson<AiSettings['provider']>('ai.provider', '')
  const model = getJson<string>('ai.model', '')
  return { provider, model, hasKey: hasSecret(AI_KEY_SECRET) }
}

export function setAiSettings(
  provider: AiSettings['provider'],
  model: string,
  apiKey?: string
): void {
  setJson('ai.provider', provider)
  setJson('ai.model', model)
  if (apiKey !== undefined) setSecret(AI_KEY_SECRET, apiKey)
}
