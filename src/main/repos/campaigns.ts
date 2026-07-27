import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { getDb, scheduleSave, saveNow } from '../db'
import { campaigns, campaignJobs, contacts } from '../db/schema'
import type {
  CampaignProgress,
  CampaignStatus,
  JobStatus,
  MessageMode,
  SendingDefaults
} from '@shared/types'

export interface CampaignRow {
  id: string
  name: string
  listId: string
  mode: string
  configJson: string
  delayMinMs: number
  delayMaxMs: number
  restEveryN: number
  restDurationMs: number
  dailyCap: number
  status: string
  createdAt: number
}

export function createCampaign(input: {
  name: string
  listId: string
  mode: MessageMode
  config: unknown
  pacing: SendingDefaults
}): CampaignRow {
  const row: CampaignRow = {
    id: randomUUID(),
    name: input.name.trim() || 'Campanha sem nome',
    listId: input.listId,
    mode: input.mode,
    configJson: JSON.stringify(input.config),
    delayMinMs: input.pacing.delayMinMs,
    delayMaxMs: input.pacing.delayMaxMs,
    restEveryN: input.pacing.restEveryN,
    restDurationMs: input.pacing.restDurationMs,
    dailyCap: input.pacing.dailyCap,
    status: 'draft',
    createdAt: Date.now()
  }
  getDb().insert(campaigns).values(row).run()
  scheduleSave()
  return row
}

export function getCampaign(id: string): CampaignRow | undefined {
  return getDb().select().from(campaigns).where(eq(campaigns.id, id)).get()
}

export function listCampaigns(limit = 50): CampaignRow[] {
  return getDb().select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(limit).all()
}

export function setCampaignStatus(id: string, status: CampaignStatus): void {
  getDb().update(campaigns).set({ status }).where(eq(campaigns.id, id)).run()
  scheduleSave()
}

/** Campanha em execucao (so permitimos uma por vez). */
export function runningCampaign(): CampaignRow | undefined {
  return getDb().select().from(campaigns).where(eq(campaigns.status, 'running')).get()
}

/* ── Jobs ───────────────────────────────────────────────────────────────── */

export interface JobRow {
  id: string
  campaignId: string
  contactId: string
  renderedText: string | null
  status: string
  attempts: number
  error: string | null
  waMessageId: string | null
  sentAt: number | null
}

/** Enfileira um job por contato, na ordem em que serao enviados. */
export function enqueueJobs(
  campaignId: string,
  jobs: { contactId: string; renderedText: string }[]
): number {
  if (jobs.length === 0) return 0
  const values = jobs.map((j) => ({
    id: randomUUID(),
    campaignId,
    contactId: j.contactId,
    renderedText: j.renderedText,
    status: 'pending' as JobStatus,
    attempts: 0,
    error: null,
    waMessageId: null,
    sentAt: null
  }))
  const CHUNK = 400
  for (let i = 0; i < values.length; i += CHUNK) {
    getDb()
      .insert(campaignJobs)
      .values(values.slice(i, i + CHUNK))
      .run()
  }
  saveNow() // a fila e a fonte da verdade: nao pode se perder
  return values.length
}

/** Proximo job pendente, na ordem de insercao. */
export function nextPendingJob(campaignId: string): JobRow | undefined {
  return getDb()
    .select()
    .from(campaignJobs)
    .where(and(eq(campaignJobs.campaignId, campaignId), eq(campaignJobs.status, 'pending')))
    .get()
}

export function markJobSending(id: string): void {
  getDb()
    .update(campaignJobs)
    .set({ status: 'sending', attempts: sql`${campaignJobs.attempts} + 1` })
    .where(eq(campaignJobs.id, id))
    .run()
  // Gravacao SINCRONA: se o processo morrer entre este ponto e o envio, o job
  // fica em 'sending' e sera tratado como ambiguo — nunca reenviado as cegas.
  saveNow()
}

export function markJobSent(id: string, waMessageId: string | null): void {
  getDb()
    .update(campaignJobs)
    .set({ status: 'sent', waMessageId, sentAt: Date.now(), error: null })
    .where(eq(campaignJobs.id, id))
    .run()
  // Gravacao SINCRONA e deliberada: perder um 'sent' faria o app reenviar para
  // quem ja recebeu, que e o comportamento que mais gera denuncia e banimento.
  saveNow()
}

export function markJobFailed(id: string, error: string): void {
  getDb()
    .update(campaignJobs)
    .set({ status: 'failed', error: error.slice(0, 500) })
    .where(eq(campaignJobs.id, id))
    .run()
  saveNow()
}

export function markJobSkipped(id: string, reason: string): void {
  getDb()
    .update(campaignJobs)
    .set({ status: 'skipped', error: reason.slice(0, 500) })
    .where(eq(campaignJobs.id, id))
    .run()
  scheduleSave()
}

/**
 * Converte jobs presos em 'sending' para 'unknown'.
 *
 * Chamado no boot: um job em 'sending' significa que o processo caiu no meio do
 * envio, entao a mensagem pode ou nao ter chegado. Politica do produto: nunca
 * reenviar automaticamente; o usuario decide.
 */
export function reconcileStuckJobs(): number {
  const stuck = getDb()
    .select({ id: campaignJobs.id })
    .from(campaignJobs)
    .where(eq(campaignJobs.status, 'sending'))
    .all()
  if (stuck.length === 0) return 0
  getDb()
    .update(campaignJobs)
    .set({
      status: 'unknown',
      error: 'O app foi encerrado durante o envio; nao foi possivel confirmar a entrega.'
    })
    .where(
      inArray(
        campaignJobs.id,
        stuck.map((s) => s.id)
      )
    )
    .run()
  saveNow()
  return stuck.length
}

export function campaignProgress(campaignId: string): CampaignProgress {
  const rows = getDb()
    .select({ status: campaignJobs.status, n: sql<number>`count(*)` })
    .from(campaignJobs)
    .where(eq(campaignJobs.campaignId, campaignId))
    .groupBy(campaignJobs.status)
    .all()

  const by = (s: JobStatus): number => rows.find((r) => r.status === s)?.n ?? 0
  const total = rows.reduce((acc, r) => acc + r.n, 0)
  return {
    campaignId,
    total,
    sent: by('sent'),
    failed: by('failed'),
    skipped: by('skipped'),
    unknown: by('unknown'),
    pending: by('pending') + by('sending'),
    status: getCampaign(campaignId)?.status ?? 'draft'
  }
}

/**
 * Quantas mensagens ja foram enviadas hoje, somando TODAS as campanhas.
 *
 * A contagem sai de `sentAt` (fonte da verdade no banco) e nao de um contador em
 * memoria: o teto diario tem de sobreviver a reinicio do app, senao bastaria
 * reabrir para estourar o limite.
 */
export function sentToday(): number {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(campaignJobs)
      .where(and(eq(campaignJobs.status, 'sent'), gte(campaignJobs.sentAt, start.getTime())))
      .get()?.n ?? 0
  )
}

/** Contatos elegiveis de uma base, na ordem de envio. */
export function eligibleContacts(listId: string): {
  id: string
  name: string | null
  phoneE164: string
  jid: string | null
  extraJson: string | null
}[] {
  return getDb()
    .select({
      id: contacts.id,
      name: contacts.name,
      phoneE164: contacts.phoneE164,
      jid: contacts.jid,
      extraJson: contacts.extraJson
    })
    .from(contacts)
    .where(and(eq(contacts.listId, listId), eq(contacts.optOut, 0)))
    .all()
}

export function jobsByStatus(campaignId: string, status: JobStatus, limit = 200): JobRow[] {
  return getDb()
    .select()
    .from(campaignJobs)
    .where(and(eq(campaignJobs.campaignId, campaignId), eq(campaignJobs.status, status)))
    .limit(limit)
    .all()
}
