import { randomUUID } from 'node:crypto'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { crmAppointments, crmLeads, contacts } from '../db/schema'
import type { CrmAppointment, CrmAppointmentInput } from '@shared/types'

interface AppointmentRow {
  id: string
  leadId: string | null
  title: string
  notes: string | null
  dueAt: number
  done: number
  notified: number
  createdAt: number
}

/**
 * Compromissos com o nome do lead ja resolvido.
 *
 * O join e LEFT em duas etapas (lead → contato) porque as duas pontas podem
 * sumir: o lead pode ser removido do CRM e o contato pode sair da base, e um
 * lembrete de "ligar quinta 14h" continua valendo mesmo assim.
 */
function select() {
  return getDb()
    .select({
      id: crmAppointments.id,
      leadId: crmAppointments.leadId,
      title: crmAppointments.title,
      notes: crmAppointments.notes,
      dueAt: crmAppointments.dueAt,
      done: crmAppointments.done,
      createdAt: crmAppointments.createdAt,
      contactName: contacts.name,
      phoneE164: crmLeads.phoneE164
    })
    .from(crmAppointments)
    .leftJoin(crmLeads, eq(crmAppointments.leadId, crmLeads.id))
    .leftJoin(contacts, eq(crmLeads.contactId, contacts.id))
}

type SelectedRow = ReturnType<ReturnType<typeof select>['all']>[number]

function toAppointment(r: SelectedRow): CrmAppointment {
  return {
    id: r.id,
    leadId: r.leadId,
    leadName: r.contactName?.trim() || r.phoneE164 || null,
    title: r.title,
    notes: r.notes,
    dueAt: r.dueAt,
    done: r.done === 1,
    createdAt: r.createdAt
  }
}

export function listAppointments(
  opts: { from?: number; to?: number; includeDone?: boolean } = {}
): CrmAppointment[] {
  const conditions = [
    opts.from != null ? gte(crmAppointments.dueAt, opts.from) : undefined,
    opts.to != null ? lte(crmAppointments.dueAt, opts.to) : undefined,
    opts.includeDone === false ? eq(crmAppointments.done, 0) : undefined
  ].filter((c) => c !== undefined)

  const query = select().orderBy(asc(crmAppointments.dueAt))
  const rows = conditions.length > 0 ? query.where(and(...conditions)).all() : query.all()
  return rows.map(toAppointment)
}

export function createAppointment(input: CrmAppointmentInput): CrmAppointment {
  const row = {
    id: randomUUID(),
    leadId: input.leadId,
    title: input.title.trim() || 'Sem titulo',
    notes: input.notes?.trim() || null,
    dueAt: input.dueAt,
    done: 0,
    // Compromisso criado para um horario que ja passou nao deve disparar
    // notificacao retroativa: o usuario acabou de digitar, ele sabe.
    notified: input.dueAt <= Date.now() ? 1 : 0,
    createdAt: Date.now()
  }
  getDb().insert(crmAppointments).values(row).run()
  scheduleSave()
  const saved = select().where(eq(crmAppointments.id, row.id)).get()
  return saved ? toAppointment(saved) : { ...row, leadName: null, done: false }
}

export function updateAppointment(id: string, input: CrmAppointmentInput): void {
  getDb()
    .update(crmAppointments)
    .set({
      leadId: input.leadId,
      title: input.title.trim() || 'Sem titulo',
      notes: input.notes?.trim() || null,
      dueAt: input.dueAt,
      // Adiar reabre a notificacao: o lembrete so vale se avisar no horario novo.
      notified: input.dueAt <= Date.now() ? 1 : 0
    })
    .where(eq(crmAppointments.id, id))
    .run()
  scheduleSave()
}

export function setAppointmentDone(id: string, done: boolean): void {
  getDb()
    .update(crmAppointments)
    .set({ done: done ? 1 : 0 })
    .where(eq(crmAppointments.id, id))
    .run()
  scheduleSave()
}

export function removeAppointment(id: string): void {
  getDb().delete(crmAppointments).where(eq(crmAppointments.id, id)).run()
  scheduleSave()
}

/**
 * Compromissos vencidos que ainda nao avisaram.
 *
 * O flag `notified` no banco (e nao um timer em memoria) e o que faz o
 * lembrete sobreviver a fechar o app: quem perdeu o horario com o app desligado
 * recebe o aviso na proxima vez que ele abrir, uma vez so.
 */
export function dueAppointments(now: number): CrmAppointment[] {
  return select()
    .where(
      and(
        eq(crmAppointments.done, 0),
        eq(crmAppointments.notified, 0),
        lte(crmAppointments.dueAt, now)
      )
    )
    .orderBy(asc(crmAppointments.dueAt))
    .all()
    .map(toAppointment)
}

export function markNotified(ids: string[]): void {
  if (ids.length === 0) return
  for (const id of ids) {
    getDb().update(crmAppointments).set({ notified: 1 }).where(eq(crmAppointments.id, id)).run()
  }
  scheduleSave()
}

/** Compromissos abertos de um lead, para o cartao do kanban. */
export function openAppointmentsFor(leadId: string): number {
  return (
    getDb()
      .select({ n: sql<number>`count(*)` })
      .from(crmAppointments)
      .where(and(eq(crmAppointments.leadId, leadId), eq(crmAppointments.done, 0)))
      .get()?.n ?? 0
  )
}

export type { AppointmentRow }
