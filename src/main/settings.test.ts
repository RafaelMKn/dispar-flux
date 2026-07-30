import { describe, it, expect, beforeAll } from 'vitest'
import { initDb } from './db'
import { getCampaignDraft, setCampaignDraft } from './settings'
import type { CampaignDraft } from '@shared/types'

beforeAll(async () => {
  await initDb()
})

describe('rascunho de campanha', () => {
  it('nao ha rascunho antes de qualquer gravacao', () => {
    expect(getCampaignDraft()).toBeNull()
  })

  it('grava e recupera o rascunho (sobrevive a troca de aba/reabertura, pois vem do banco)', () => {
    const draft: CampaignDraft = {
      listId: 'lista-1',
      mode: 'rotate',
      name: 'Campanha de teste',
      config: { messages: ['Oi [nome]', 'Ola [nome]'] },
      pacing: { delayMinMs: 1, delayMaxMs: 2, restEveryN: 3, restDurationMs: 4, dailyCap: 5 }
    }
    setCampaignDraft(draft)
    expect(getCampaignDraft()).toEqual(draft)
  })

  it('limpa o rascunho ao salvar null (ex.: depois de iniciar a campanha)', () => {
    setCampaignDraft({
      listId: 'lista-2',
      mode: 'fixed',
      name: '',
      config: { text: 'oi' },
      pacing: null
    })
    setCampaignDraft(null)
    expect(getCampaignDraft()).toBeNull()
  })
})
