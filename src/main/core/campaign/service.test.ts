import { describe, it, expect, beforeAll } from 'vitest'
import { initDb } from '../../db'
import { createContactList } from '../../repos/contactLists'
import { insertContacts, pageContacts, setWaResult } from '../../repos/contacts'
import { markJobSent, nextPendingJob } from '../../repos/campaigns'
import { planCampaign, startCampaign } from './service'
import { campaignRunner, type Sender } from './worker'

const FAST = { delayMinMs: 0, delayMaxMs: 0, restEveryN: 0, restDurationMs: 0, dailyCap: 0 }

function makeSender(): Sender & { enviados: string[] } {
  const enviados: string[] = []
  return {
    enviados,
    isReady: () => true,
    sendTyping: async () => {},
    sendText: async (jid: string) => {
      enviados.push(jid)
      return `wamid-${enviados.length}`
    }
  }
}

let bloco = 0

function seedList(nome: string, n: number): string {
  const list = createContactList(nome)
  const b = bloco++
  insertContacts(
    Array.from({ length: n }, (_, i) => ({
      listId: list.id,
      name: `Contato ${i + 1}`,
      phoneE164: `+5511${String(b).padStart(2, '0')}${String(i).padStart(7, '0')}`,
      extraJson: null
    }))
  )
  const { rows } = pageContacts(list.id, { limit: 500 })
  for (const c of rows) setWaResult(c.id, true, `${c.phoneE164.replace('+', '')}@s.whatsapp.net`)
  return list.id
}

beforeAll(async () => {
  await initDb()
})

describe('nao reenviar entre campanhas (skipAlreadySent)', () => {
  it('sem a flag, uma segunda campanha na mesma base reenvia para todos de novo', async () => {
    const listId = seedList('Dedup off', 3)

    const first = startCampaign({
      name: 'Primeira',
      listId,
      mode: 'fixed',
      config: { text: 'Oi [nome]' },
      pacing: FAST
    })
    await campaignRunner.run(first.campaignId, makeSender())

    const plan = planCampaign(listId, 'fixed', { text: 'Oi de novo [nome]' })
    expect(plan.eligible).toBe(3)
    expect(plan.skippedAlreadySent).toBe(0)

    const second = startCampaign({
      name: 'Segunda',
      listId,
      mode: 'fixed',
      config: { text: 'Oi de novo [nome]' },
      pacing: FAST
    })
    expect(second.queued).toBe(3)
  })

  it('com a flag, exclui quem ja recebeu (status sent) em campanha anterior da mesma base', async () => {
    const listId = seedList('Dedup on', 4)

    const first = startCampaign({
      name: 'Primeira',
      listId,
      mode: 'fixed',
      config: { text: 'Oi [nome]' },
      pacing: FAST
    })
    await campaignRunner.run(first.campaignId, makeSender())

    const plan = planCampaign(listId, 'fixed', { text: 'Oi de novo [nome]' }, true)
    expect(plan.eligible).toBe(0)
    expect(plan.skippedAlreadySent).toBe(4)

    expect(() =>
      startCampaign({
        name: 'Segunda',
        listId,
        mode: 'fixed',
        config: { text: 'Oi de novo [nome]' },
        pacing: FAST,
        skipAlreadySent: true
      })
    ).toThrow(/nenhum contato elegivel/i)
  })

  it('com a flag, so exclui quem tem job "sent" — pendente/falho continua elegivel', async () => {
    const listId = seedList('Dedup parcial', 3)

    const first = startCampaign({
      name: 'Primeira',
      listId,
      mode: 'fixed',
      config: { text: 'Oi [nome]' },
      pacing: FAST
    })
    // Envia so o primeiro; os outros dois ficam pendentes na fila.
    const job = nextPendingJob(first.campaignId)
    expect(job).toBeDefined()
    markJobSent(job!.id, 'wamid-manual')

    const plan = planCampaign(listId, 'fixed', { text: 'Oi de novo [nome]' }, true)
    expect(plan.eligible).toBe(2)
    expect(plan.skippedAlreadySent).toBe(1)
  })
})
