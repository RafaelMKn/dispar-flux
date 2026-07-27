import { inArray } from 'drizzle-orm'
import { getDb, scheduleSave } from '../db'
import { optOuts } from '../db/schema'

/** Marca um numero como descadastrado globalmente (vale para todas as bases). */
export function addOptOut(phoneE164: string, reason?: string): void {
  getDb()
    .insert(optOuts)
    .values({ phoneE164, reason: reason ?? null, createdAt: Date.now() })
    .onConflictDoNothing()
    .run()
  scheduleSave()
}

export function removeOptOut(phoneE164: string): void {
  getDb().delete(optOuts).where(inArray(optOuts.phoneE164, [phoneE164])).run()
  scheduleSave()
}

/** Conjunto de numeros descadastrados, para filtrar em lote sem N consultas. */
export function getOptOutSet(phones?: string[]): Set<string> {
  const q = getDb().select({ phone: optOuts.phoneE164 }).from(optOuts)
  const rows = phones?.length
    ? q.where(inArray(optOuts.phoneE164, phones)).all()
    : q.all()
  return new Set(rows.map((r) => r.phone))
}

export function isOptedOut(phoneE164: string): boolean {
  return getOptOutSet([phoneE164]).has(phoneE164)
}
