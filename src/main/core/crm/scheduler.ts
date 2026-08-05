import { listRules, markRuleRun } from '../../repos/followups'
import { leadsWithoutReply, registerFollowUp, leadLabel } from '../../repos/crm'
import { dueAppointments, markNotified } from '../../repos/agenda'
import { getSendingDefaults } from '../../settings'
import { campaignRunner } from '../campaign/worker'
import { isSenderReady, startCampaignForContacts } from '../campaign/service'
import { scoped } from '../../logger'
import { crmEvents } from './leads'
import { isLeadDue, isWithinWindow, leadDueAt, nextWindowOpening } from './rules'
import type { FollowUpRule, ScheduledFollowUp } from '@shared/types'

const log = scoped('crm-cron')

/**
 * De quanto em quanto tempo o agendador acorda.
 *
 * Cinco minutos e deliberadamente grosso: a menor unidade que uma regra
 * configura e a hora, entao acordar mais vezes so gastaria CPU. E como o app
 * fica na bandeja durante o disparo, este tick roda tambem com a janela
 * fechada — que e o ponto: o follow-up nao pode depender de alguem estar
 * olhando a tela.
 */
const TICK_MS = 5 * 60 * 1000

/** Injetado pelo boot para nao arrastar o Electron para dentro dos testes. */
export interface SchedulerHost {
  notify: (title: string, body: string) => void
}

let host: SchedulerHost | null = null
let timer: ReturnType<typeof setInterval> | null = null

export function setSchedulerHost(next: SchedulerHost | null): void {
  host = next
}

/* ── Follow-ups ─────────────────────────────────────────────────────────── */

interface DueLead {
  leadId: string
  contactId: string
  listId: string
}

/** Leads que a regra pegaria agora, ignorando a janela de horario. */
function dueLeadsFor(rule: FollowUpRule, now: number): DueLead[] {
  return leadsWithoutReply(rule.listId)
    .filter((lead) => isLeadDue(lead, rule, now))
    .filter((lead): lead is typeof lead & { contactId: string; listId: string } =>
      Boolean(lead.contactId && lead.listId)
    )
    .map((lead) => ({ leadId: lead.id, contactId: lead.contactId, listId: lead.listId }))
}

export function previewRule(
  rule: FollowUpRule,
  now = Date.now()
): { eligible: number; nextWindowAt: number; windowOpen: boolean } {
  return {
    eligible: dueLeadsFor(rule, now).length,
    nextWindowAt: nextWindowOpening(now, rule),
    windowOpen: isWithinWindow(now, rule)
  }
}

/**
 * Dispara o follow-up de uma regra.
 *
 * `ignoreWindow` existe para o botao "disparar agora" da tela de Cron — o
 * usuario clicando e uma decisao explicita, e diferente de o agendador decidir
 * sozinho fora do horario combinado.
 *
 * Uma campanha por base: `campaigns.list_id` precisa dizer a verdade, e uma
 * regra que vale para todas as bases pode pegar leads de varias.
 */
export function runRule(
  rule: FollowUpRule,
  opts: { ignoreWindow?: boolean } = {}
): { campaignId: string; queued: number } | null {
  const now = Date.now()
  if (!opts.ignoreWindow && !isWithinWindow(now, rule)) return null
  if (!isSenderReady()) {
    log.info('follow-up adiado: WhatsApp desconectado', { regra: rule.name })
    return null
  }
  // Uma campanha por vez e uma regra do motor. Adiar para o proximo tick e
  // melhor do que competir com o disparo que o usuario iniciou na mao.
  if (campaignRunner.activeCampaignId) {
    log.info('follow-up adiado: ja existe campanha em execucao', { regra: rule.name })
    return null
  }

  const due = dueLeadsFor(rule, now)
  if (due.length === 0) return null

  const byList = new Map<string, DueLead[]>()
  for (const lead of due) {
    const bucket = byList.get(lead.listId)
    if (bucket) bucket.push(lead)
    else byList.set(lead.listId, [lead])
  }

  // Só a primeira base neste tick: o runner atende uma campanha por vez, e as
  // demais entram nos proximos ticks sem nenhum estado extra para guardar.
  const [listId, leads] = [...byList.entries()][0]
  const started = startCampaignForContacts({
    name: `Follow-up: ${rule.name}`,
    listId,
    mode: rule.mode,
    config: rule.config,
    pacing: getSendingDefaults(),
    contactIds: leads.map((l) => l.contactId)
  })

  markRuleRun(rule.id)
  if (!started) return null

  // Contabiliza ANTES de o envio terminar: se o app cair no meio, o teto de
  // follow-ups ja esta gravado e ninguem recebe a mesma mensagem duas vezes.
  // Perder um follow-up e barato; repetir e o que gera denuncia.
  for (const lead of leads) registerFollowUp(lead.leadId)
  crmEvents.emit('changed')

  log.info('follow-up disparado', {
    regra: rule.name,
    campanha: started.campaignId,
    enfileirados: started.queued
  })
  return started
}

/** Follow-ups que as regras ativas ainda vao disparar, para a agenda. */
export function upcomingFollowUps(limit = 200, now = Date.now()): ScheduledFollowUp[] {
  const out: ScheduledFollowUp[] = []
  for (const rule of listRules()) {
    if (!rule.enabled) continue
    for (const lead of leadsWithoutReply(rule.listId)) {
      if (!lead.contactId) continue
      const eligibleAt = leadDueAt(lead, rule)
      if (eligibleAt == null) continue
      out.push({
        ruleId: rule.id,
        ruleName: rule.name,
        leadId: lead.id,
        leadName: leadLabel(lead.id) ?? lead.phoneE164,
        phoneE164: lead.phoneE164,
        // O envio so acontece quando as DUAS condicoes valem: o prazo venceu e
        // a janela de horario esta aberta. Mostrar so o prazo faria a agenda
        // prometer envio de madrugada.
        dueAt: nextWindowOpening(Math.max(eligibleAt, now), rule)
      })
    }
  }
  return out.sort((a, b) => a.dueAt - b.dueAt).slice(0, limit)
}

/* ── Agenda ─────────────────────────────────────────────────────────────── */

function fireAppointmentReminders(now: number): void {
  const due = dueAppointments(now)
  if (due.length === 0) return
  for (const appointment of due) {
    const quem = appointment.leadName ? ` — ${appointment.leadName}` : ''
    host?.notify('Compromisso na agenda', `${appointment.title}${quem}`)
  }
  markNotified(due.map((a) => a.id))
  crmEvents.emit('changed')
}

/* ── Tick ───────────────────────────────────────────────────────────────── */

export function tick(): void {
  const now = Date.now()
  try {
    fireAppointmentReminders(now)
  } catch (e) {
    log.error('falha ao avisar compromissos', e)
  }

  for (const rule of listRules()) {
    if (!rule.enabled) continue
    try {
      runRule(rule)
    } catch (e) {
      log.error('falha ao rodar regra de follow-up', { regra: rule.name, erro: e })
    }
  }
}

export function startScheduler(next: SchedulerHost): void {
  setSchedulerHost(next)
  if (timer) return
  // Um tick logo no boot pega os compromissos que venceram com o app fechado e
  // os follow-ups que ficaram para tras.
  setTimeout(tick, 15_000)
  timer = setInterval(tick, TICK_MS)
  log.info('agendador do CRM iniciado', { intervaloMs: TICK_MS })
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
