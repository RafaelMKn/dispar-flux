import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { getDb, scheduleSave, saveNow } from '../db'
import { crmLeads, crmStages, contacts, contactLists, campaigns, chats } from '../db/schema'
import { getOptOutSet } from './optOuts'
import type { CrmBoard, CrmLead, CrmStage, StageRole } from '@shared/types'

/**
 * Colunas iniciais.
 *
 * As duas primeiras carregam os papeis que a automacao usa: o lead nasce em
 * 'entry' quando o disparo sai e anda para 'active' na primeira resposta. O
 * usuario pode renomear as duas — o papel viaja com a coluna, nao com o nome.
 */
const DEFAULT_STAGES: { name: string; role: StageRole }[] = [
  { name: 'Aguardando resposta', role: 'entry' },
  { name: 'Em andamento', role: 'active' },
  { name: 'Negociacao', role: null },
  { name: 'Ganho', role: null },
  { name: 'Perdido', role: null }
]

/**
 * Cria as colunas padrao na primeira vez. Idempotente e barato (um count), e
 * chamado por toda leitura/escrita porque nao ha migracao com dados: o CRM
 * precisa existir no primeiro clique, inclusive num banco antigo.
 */
export function ensureStages(): void {
  const n =
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(crmStages)
      .get()?.n ?? 0
  if (n > 0) return
  const now = Date.now()
  getDb()
    .insert(crmStages)
    .values(
      DEFAULT_STAGES.map((s, i) => ({
        id: randomUUID(),
        name: s.name,
        position: i,
        role: s.role,
        createdAt: now
      }))
    )
    .run()
  saveNow()
}

export function listStages(): CrmStage[] {
  ensureStages()
  return getDb()
    .select({
      id: crmStages.id,
      name: crmStages.name,
      position: crmStages.position,
      role: crmStages.role
    })
    .from(crmStages)
    .orderBy(asc(crmStages.position))
    .all()
    .map((s) => ({ ...s, role: (s.role as StageRole) ?? null }))
}

/** Coluna de um papel. Cai para a primeira coluna se o papel se perdeu. */
export function stageByRole(role: Exclude<StageRole, null>): CrmStage {
  const stages = listStages()
  return stages.find((s) => s.role === role) ?? stages[0]
}

export function createStage(name: string): CrmStage {
  ensureStages()
  const clean = name.trim() || 'Nova coluna'
  const max =
    getDb()
      .select({ n: sql<number>`coalesce(max(position), -1)` })
      .from(crmStages)
      .get()?.n ?? -1
  const row = {
    id: randomUUID(),
    name: clean,
    position: max + 1,
    role: null,
    createdAt: Date.now()
  }
  getDb().insert(crmStages).values(row).run()
  scheduleSave()
  return { id: row.id, name: row.name, position: row.position, role: null }
}

export function renameStage(id: string, name: string): void {
  const clean = name.trim()
  if (!clean) return
  getDb().update(crmStages).set({ name: clean }).where(eq(crmStages.id, id)).run()
  scheduleSave()
}

/** Troca a coluna de lugar com a vizinha. -1 = esquerda, 1 = direita. */
export function moveStage(id: string, direction: -1 | 1): void {
  const stages = listStages()
  const index = stages.findIndex((s) => s.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= stages.length) return

  // Reescreve as posicoes da lista inteira depois do swap: manter posicoes
  // densas (0..n-1) evita que remocoes antigas deixem buracos que quebrem a
  // proxima troca.
  const reordered = [...stages]
  ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
  reordered.forEach((s, position) => {
    getDb().update(crmStages).set({ position }).where(eq(crmStages.id, s.id)).run()
  })
  scheduleSave()
}

/**
 * Remove a coluna e leva os leads dela para `moveToId`.
 *
 * As colunas com papel ('entry'/'active') nao podem sair: sem elas a automacao
 * nao teria para onde mandar o lead. A UI ja esconde o botao, mas a regra vive
 * aqui porque e ela que protege os dados.
 */
export function removeStage(id: string, moveToId: string): void {
  const stages = listStages()
  const stage = stages.find((s) => s.id === id)
  if (!stage || stage.role !== null) return
  if (stages.length <= 1 || moveToId === id) return
  if (!stages.some((s) => s.id === moveToId)) return

  getDb().update(crmLeads).set({ stageId: moveToId }).where(eq(crmLeads.stageId, id)).run()
  getDb().delete(crmStages).where(eq(crmStages.id, id)).run()
  listStages().forEach((s, position) => {
    getDb().update(crmStages).set({ position }).where(eq(crmStages.id, s.id)).run()
  })
  saveNow()
}

/* ── Leads ──────────────────────────────────────────────────────────────── */

export interface LeadRow {
  id: string
  phoneE164: string
  contactId: string | null
  jid: string | null
  stageId: string
  campaignId: string | null
  firstSentAt: number | null
  firstReplyAt: number | null
  lastInboundAt: number | null
  lastOutboundAt: number | null
  followUps: number
  lastFollowUpAt: number | null
  ignoredAutoReplies: number
  notes: string | null
  createdAt: number
  updatedAt: number
}

export function getLeadById(id: string): LeadRow | undefined {
  return getDb().select().from(crmLeads).where(eq(crmLeads.id, id)).get()
}

export function getLeadByPhone(phoneE164: string): LeadRow | undefined {
  return getDb().select().from(crmLeads).where(eq(crmLeads.phoneE164, phoneE164)).get()
}

/** Caminho quente: roda a cada mensagem recebida. */
export function getLeadByJid(jid: string): LeadRow | undefined {
  return getDb().select().from(crmLeads).where(eq(crmLeads.jid, jid)).get()
}

export interface UpsertLeadInput {
  phoneE164: string
  contactId?: string | null
  jid?: string | null
  campaignId?: string | null
}

/**
 * Garante que existe um lead para o telefone, sem sobrescrever o que ja foi
 * conquistado (coluna atual, data da primeira resposta, anotacoes).
 *
 * Os campos opcionais so preenchem buracos — um lead criado sem jid ganha o jid
 * quando o disparo sai, mas a campanha de origem nao muda depois de gravada.
 */
export function ensureLead(input: UpsertLeadInput): LeadRow {
  ensureStages()
  const existing = getLeadByPhone(input.phoneE164)
  const now = Date.now()

  if (existing) {
    const patch: Partial<LeadRow> = {}
    if (input.contactId && !existing.contactId) patch.contactId = input.contactId
    if (input.jid && !existing.jid) patch.jid = input.jid
    if (input.campaignId && !existing.campaignId) patch.campaignId = input.campaignId
    if (Object.keys(patch).length > 0) {
      getDb()
        .update(crmLeads)
        .set({ ...patch, updatedAt: now })
        .where(eq(crmLeads.id, existing.id))
        .run()
      scheduleSave()
      return { ...existing, ...patch, updatedAt: now }
    }
    return existing
  }

  const row: LeadRow = {
    id: randomUUID(),
    phoneE164: input.phoneE164,
    contactId: input.contactId ?? null,
    jid: input.jid ?? null,
    stageId: stageByRole('entry').id,
    campaignId: input.campaignId ?? null,
    firstSentAt: null,
    firstReplyAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    followUps: 0,
    lastFollowUpAt: null,
    ignoredAutoReplies: 0,
    notes: null,
    createdAt: now,
    updatedAt: now
  }
  getDb().insert(crmLeads).values(row).run()
  scheduleSave()
  return row
}

export function updateLead(id: string, patch: Partial<Omit<LeadRow, 'id'>>): void {
  getDb()
    .update(crmLeads)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(crmLeads.id, id))
    .run()
  scheduleSave()
}

export function moveLead(id: string, stageId: string): void {
  if (!listStages().some((s) => s.id === stageId)) return
  updateLead(id, { stageId })
}

export function setLeadNotes(id: string, notes: string): void {
  updateLead(id, { notes: notes.trim() || null })
}

export function removeLead(id: string): void {
  getDb().delete(crmLeads).where(eq(crmLeads.id, id)).run()
  scheduleSave()
}

/** +1 no contador de follow-ups enviados, usado como teto pelas regras do cron. */
export function registerFollowUp(id: string): void {
  getDb()
    .update(crmLeads)
    .set({
      followUps: sql`${crmLeads.followUps} + 1`,
      lastFollowUpAt: Date.now(),
      updatedAt: Date.now()
    })
    .where(eq(crmLeads.id, id))
    .run()
  saveNow()
}

/* ── Visao do kanban ────────────────────────────────────────────────────── */

/**
 * Leads com o que o cartao precisa mostrar: nome do contato, base de origem,
 * campanha e nao-lidas da conversa.
 *
 * Todos os joins sao LEFT: apagar a base, o contato ou a campanha nao pode
 * fazer o lead sumir do kanban — o historico do relacionamento continua valendo.
 */
export function listLeads(): CrmLead[] {
  ensureStages()
  const rows = getDb()
    .select({
      id: crmLeads.id,
      stageId: crmLeads.stageId,
      phoneE164: crmLeads.phoneE164,
      contactId: crmLeads.contactId,
      jid: crmLeads.jid,
      name: contacts.name,
      listName: contactLists.name,
      campaignId: crmLeads.campaignId,
      campaignName: campaigns.name,
      firstSentAt: crmLeads.firstSentAt,
      firstReplyAt: crmLeads.firstReplyAt,
      lastInboundAt: crmLeads.lastInboundAt,
      lastOutboundAt: crmLeads.lastOutboundAt,
      followUps: crmLeads.followUps,
      lastFollowUpAt: crmLeads.lastFollowUpAt,
      ignoredAutoReplies: crmLeads.ignoredAutoReplies,
      notes: crmLeads.notes,
      unread: chats.unread,
      createdAt: crmLeads.createdAt,
      updatedAt: crmLeads.updatedAt
    })
    .from(crmLeads)
    .leftJoin(contacts, eq(crmLeads.contactId, contacts.id))
    .leftJoin(contactLists, eq(contacts.listId, contactLists.id))
    .leftJoin(campaigns, eq(crmLeads.campaignId, campaigns.id))
    .leftJoin(chats, eq(crmLeads.jid, chats.jid))
    .all()

  // Um SELECT so para os opt-outs, e nao um join: `opt_outs` e por telefone e a
  // consulta em lote ja existe e e usada pelo disparo.
  const optedOut = getOptOutSet(rows.map((r) => r.phoneE164))

  return rows
    .map((r) => ({
      ...r,
      unread: r.unread ?? 0,
      optOut: optedOut.has(r.phoneE164)
    }))
    .sort((a, b) => (b.lastInboundAt ?? b.updatedAt) - (a.lastInboundAt ?? a.updatedAt))
}

export function board(): CrmBoard {
  return { stages: listStages(), leads: listLeads() }
}

/**
 * Leads que nunca responderam, para o cron de follow-up.
 *
 * `listId` filtra pela base de origem do contato. Leads orfaos (base apagada)
 * so entram quando a regra vale para todas as bases — mandar follow-up de uma
 * base especifica para quem nao esta mais nela seria surpresa.
 */
export function leadsWithoutReply(listId: string | null): (LeadRow & { listId: string | null })[] {
  const rows = getDb()
    .select({
      id: crmLeads.id,
      phoneE164: crmLeads.phoneE164,
      contactId: crmLeads.contactId,
      jid: crmLeads.jid,
      stageId: crmLeads.stageId,
      campaignId: crmLeads.campaignId,
      firstSentAt: crmLeads.firstSentAt,
      firstReplyAt: crmLeads.firstReplyAt,
      lastInboundAt: crmLeads.lastInboundAt,
      lastOutboundAt: crmLeads.lastOutboundAt,
      followUps: crmLeads.followUps,
      lastFollowUpAt: crmLeads.lastFollowUpAt,
      ignoredAutoReplies: crmLeads.ignoredAutoReplies,
      notes: crmLeads.notes,
      createdAt: crmLeads.createdAt,
      updatedAt: crmLeads.updatedAt,
      listId: contacts.listId
    })
    .from(crmLeads)
    .leftJoin(contacts, eq(crmLeads.contactId, contacts.id))
    .where(isNull(crmLeads.firstReplyAt))
    .all()

  return listId ? rows.filter((r) => r.listId === listId) : rows
}

/** Nome amigavel do lead para agenda e notificacoes. */
export function leadLabel(leadId: string): string | null {
  const row = getDb()
    .select({ name: contacts.name, phone: crmLeads.phoneE164 })
    .from(crmLeads)
    .leftJoin(contacts, eq(crmLeads.contactId, contacts.id))
    .where(eq(crmLeads.id, leadId))
    .get()
  if (!row) return null
  return row.name?.trim() || row.phone
}

/** Contagem por coluna, usada pelo cabecalho do kanban sem carregar os cartoes. */
export function countByStage(stageId: string): number {
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(crmLeads)
      .where(and(eq(crmLeads.stageId, stageId)))
      .get()?.n ?? 0
  )
}
