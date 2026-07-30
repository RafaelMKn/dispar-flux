import { describe, it, expect, beforeAll } from 'vitest'
import { initDb } from './db'
import {
  getCampaignDraft,
  setCampaignDraft,
  getBackgroundSettings,
  setBackgroundSettings,
  shouldShowTrayNotice,
  DEFAULT_BACKGROUND,
  setJson
} from './settings'
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

describe('preferencias de segundo plano', () => {
  it('comeca com fechar-para-bandeja ligado e iniciar-com-o-sistema desligado', () => {
    expect(getBackgroundSettings()).toEqual({ closeToTray: true, launchAtLogin: false })
  })

  it('grava e recupera as duas chaves', () => {
    setBackgroundSettings({ closeToTray: false, launchAtLogin: true })
    expect(getBackgroundSettings()).toEqual({ closeToTray: false, launchAtLogin: true })
  })

  it('completa com o padrao o que foi gravado por uma versao anterior', () => {
    // Um banco de quem atualizou o app pode ter a chave gravada sem os campos
    // novos; sem o merge, `closeToTray` viria `undefined` e o X nunca esconderia
    // a janela.
    setJson('background', { closeToTray: false })
    expect(getBackgroundSettings()).toEqual({
      ...DEFAULT_BACKGROUND,
      closeToTray: false
    })
  })
})

describe('aviso da bandeja', () => {
  it('aparece so na primeira vez que o app some na bandeja', () => {
    expect(shouldShowTrayNotice()).toBe(true)
    expect(shouldShowTrayNotice()).toBe(false)
    expect(shouldShowTrayNotice()).toBe(false)
  })
})
