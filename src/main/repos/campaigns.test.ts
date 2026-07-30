import { describe, it, expect, beforeAll } from 'vitest'
import { initDb } from '../db'
import { createContactList } from './contactLists'
import { insertContacts, pageContacts, setWaResult } from './contacts'
import {
  createCampaign,
  enqueueJobs,
  markJobSent,
  markJobFailed,
  jobsWithContacts
} from './campaigns'

beforeAll(async () => {
  await initDb()
})

function seedList(nome: string, n: number): { listId: string; contactIds: string[] } {
  const list = createContactList(nome)
  insertContacts(
    Array.from({ length: n }, (_, i) => ({
      listId: list.id,
      name: `Contato ${i + 1}`,
      phoneE164: `+55119999${String(i).padStart(4, '0')}`,
      extraJson: null
    }))
  )
  const { rows } = pageContacts(list.id, { limit: 500 })
  for (const c of rows) setWaResult(c.id, true, `${c.phoneE164.replace('+', '')}@s.whatsapp.net`)
  return { listId: list.id, contactIds: rows.map((r) => r.id) }
}

describe('jobsWithContacts', () => {
  it('traz nome/telefone do contato junto com o status do job, na ordem de envio', () => {
    const { listId, contactIds } = seedList('Detalhe disparo', 3)
    const campaign = createCampaign({
      name: 'Campanha',
      listId,
      mode: 'fixed',
      config: { text: 'Oi' },
      pacing: { delayMinMs: 0, delayMaxMs: 0, restEveryN: 0, restDurationMs: 0, dailyCap: 0 }
    })
    enqueueJobs(
      campaign.id,
      contactIds.map((id, i) => ({ contactId: id, renderedText: `Mensagem ${i + 1}` }))
    )

    const { rows, total } = jobsWithContacts(campaign.id)
    expect(total).toBe(3)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.contactName)).toEqual(['Contato 1', 'Contato 2', 'Contato 3'])
    expect(rows.every((r) => r.status === 'pending')).toBe(true)
    expect(rows[0].phoneE164).toMatch(/^\+55119999/)
  })

  it('filtra por status e reflete mudancas (enviado/falhou) imediatamente', () => {
    const { listId, contactIds } = seedList('Detalhe filtro', 3)
    const campaign = createCampaign({
      name: 'Campanha',
      listId,
      mode: 'fixed',
      config: { text: 'Oi' },
      pacing: { delayMinMs: 0, delayMaxMs: 0, restEveryN: 0, restDurationMs: 0, dailyCap: 0 }
    })
    enqueueJobs(
      campaign.id,
      contactIds.map((id, i) => ({ contactId: id, renderedText: `Mensagem ${i + 1}` }))
    )
    const all = jobsWithContacts(campaign.id).rows
    markJobSent(all[0].id, 'wamid-1')
    markJobFailed(all[1].id, 'rede caiu')

    expect(jobsWithContacts(campaign.id, { status: 'sent' }).rows.map((r) => r.id)).toEqual([
      all[0].id
    ])
    expect(jobsWithContacts(campaign.id, { status: 'failed' }).rows[0].error).toBe('rede caiu')
    expect(jobsWithContacts(campaign.id, { status: 'pending' }).rows).toHaveLength(1)
  })

  it('respeita limit/offset e informa o total real', () => {
    const { listId, contactIds } = seedList('Detalhe paginacao', 5)
    const campaign = createCampaign({
      name: 'Campanha',
      listId,
      mode: 'fixed',
      config: { text: 'Oi' },
      pacing: { delayMinMs: 0, delayMaxMs: 0, restEveryN: 0, restDurationMs: 0, dailyCap: 0 }
    })
    enqueueJobs(
      campaign.id,
      contactIds.map((id, i) => ({ contactId: id, renderedText: `Mensagem ${i + 1}` }))
    )

    const page = jobsWithContacts(campaign.id, { limit: 2, offset: 1 })
    expect(page.total).toBe(5)
    expect(page.rows).toHaveLength(2)
    expect(page.rows.map((r) => r.contactName)).toEqual(['Contato 2', 'Contato 3'])
  })
})
