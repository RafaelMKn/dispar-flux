import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { crmFollowups } from '../db/schema'
import type { FollowUpMode, FollowUpRule, FollowUpRuleInput, MessageConfig } from '@shared/types'

interface RuleRow {
  id: string
  name: string
  listId: string | null
  afterHours: number
  mode: string
  configJson: string
  weekdays: string
  startMinute: number
  endMinute: number
  maxFollowUps: number
  enabled: number
  lastRunAt: number | null
  createdAt: number
}

function parseConfig(json: string): MessageConfig {
  try {
    return JSON.parse(json) as MessageConfig
  } catch {
    return {}
  }
}

/** "1,2,3" → [1,2,3]. Descarta lixo em vez de quebrar a tela. */
function parseWeekdays(raw: string): number[] {
  return raw
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
}

function toRule(r: RuleRow): FollowUpRule {
  return {
    id: r.id,
    name: r.name,
    listId: r.listId,
    afterHours: r.afterHours,
    mode: (r.mode === 'rotate' ? 'rotate' : 'fixed') as FollowUpMode,
    config: parseConfig(r.configJson),
    weekdays: parseWeekdays(r.weekdays),
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    maxFollowUps: r.maxFollowUps,
    enabled: r.enabled === 1,
    lastRunAt: r.lastRunAt,
    createdAt: r.createdAt
  }
}

function toColumns(input: FollowUpRuleInput): Omit<RuleRow, 'id' | 'lastRunAt' | 'createdAt'> {
  return {
    name: input.name.trim() || 'Regra sem nome',
    listId: input.listId,
    afterHours: Math.max(1, Math.round(input.afterHours)),
    mode: input.mode,
    configJson: JSON.stringify(input.config),
    weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b).join(','),
    startMinute: input.startMinute,
    endMinute: input.endMinute,
    maxFollowUps: Math.max(1, Math.round(input.maxFollowUps)),
    enabled: input.enabled ? 1 : 0
  }
}

export function listRules(): FollowUpRule[] {
  return getDb().select().from(crmFollowups).orderBy(asc(crmFollowups.createdAt)).all().map(toRule)
}

export function getRule(id: string): FollowUpRule | undefined {
  const row = getDb().select().from(crmFollowups).where(eq(crmFollowups.id, id)).get()
  return row ? toRule(row) : undefined
}

export function createRule(input: FollowUpRuleInput): FollowUpRule {
  const row: RuleRow = {
    id: randomUUID(),
    ...toColumns(input),
    lastRunAt: null,
    createdAt: Date.now()
  }
  getDb().insert(crmFollowups).values(row).run()
  scheduleSave()
  return toRule(row)
}

export function updateRule(id: string, input: FollowUpRuleInput): void {
  getDb().update(crmFollowups).set(toColumns(input)).where(eq(crmFollowups.id, id)).run()
  scheduleSave()
}

export function setRuleEnabled(id: string, enabled: boolean): void {
  getDb()
    .update(crmFollowups)
    .set({ enabled: enabled ? 1 : 0 })
    .where(eq(crmFollowups.id, id))
    .run()
  scheduleSave()
}

export function markRuleRun(id: string): void {
  getDb().update(crmFollowups).set({ lastRunAt: Date.now() }).where(eq(crmFollowups.id, id)).run()
  scheduleSave()
}

export function removeRule(id: string): void {
  getDb().delete(crmFollowups).where(eq(crmFollowups.id, id)).run()
  scheduleSave()
}
