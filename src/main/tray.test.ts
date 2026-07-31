import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { initDb } from './db'
import { createContactList } from './repos/contactLists'
import { insertContacts, pageContacts } from './repos/contacts'
import {
  createCampaign,
  enqueueJobs,
  listCampaigns,
  markJobSent,
  nextPendingJob,
  setCampaignStatus
} from './repos/campaigns'
import { campaignEvents, campaignRunner } from './core/campaign/worker'
import { pauseCampaign, resumeCampaign } from './core/campaign/service'
import type { CampaignStatus, SendingDefaults } from '@shared/types'

/**
 * A bandeja e a unica interface do app com a janela fechada, e a issue #7 se
 * resume a duas garantias: o disparo continua rodando escondido, e o usuario
 * consegue ver e comandar isso sem reabrir a tela.
 *
 * Electron nao existe no vitest, entao `Tray`/`Menu`/`Notification` viram
 * duplos que registram o que a bandeja pediu — o menu montado e o texto de cada
 * notificacao. E o que da para verificar sem abrir o app; o desenho do icone na
 * barra de tarefas continua sendo teste manual.
 */

interface MenuItemStub {
  label?: string
  type?: string
  enabled?: boolean
  click?: () => void
}

const stub = vi.hoisted(() => ({
  /** `new Tray()` deve estourar? Simula sistema sem area de notificacao. */
  falhaAoCriar: false,
  destruidos: 0,
  tooltip: '',
  menu: [] as { label?: string; type?: string; enabled?: boolean; click?: () => void }[],
  /** Callback do clique no icone. */
  aoClicar: null as (() => void) | null,
  /** Callback do clique na notificacao. */
  aoClicarNotificacao: null as (() => void) | null,
  notificacoes: [] as { title: string; body: string }[],
  redimensionamentos: [] as { width: number; height: number }[],
  empacotado: false,
  loginItem: null as { openAtLogin: boolean; args?: string[] } | null,
  abertoNoLogin: false
}))

vi.mock('electron', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()

  class Tray {
    constructor() {
      if (stub.falhaAoCriar) throw new Error('sistema sem area de notificacao')
    }
    setToolTip(t: string): void {
      stub.tooltip = t
    }
    setContextMenu(m: MenuItemStub[]): void {
      stub.menu = m
    }
    setIgnoreDoubleClickEvents(): void {}
    on(event: string, cb: () => void): void {
      if (event === 'click') stub.aoClicar = cb
    }
    destroy(): void {
      stub.destruidos += 1
    }
  }

  class Notification {
    constructor(private readonly opts: { title: string; body: string }) {}
    static isSupported(): boolean {
      return true
    }
    on(event: string, cb: () => void): void {
      if (event === 'click') stub.aoClicarNotificacao = cb
    }
    show(): void {
      stub.notificacoes.push({ title: this.opts.title, body: this.opts.body })
    }
  }

  return {
    ...actual,
    app: {
      ...(actual.app as object),
      getAppPath: (): string => process.cwd(),
      get isPackaged(): boolean {
        return stub.empacotado
      },
      setLoginItemSettings: (s: { openAtLogin: boolean; args?: string[] }): void => {
        stub.loginItem = s
      },
      getLoginItemSettings: (): { wasOpenedAtLogin: boolean } => ({
        wasOpenedAtLogin: stub.abertoNoLogin
      })
    },
    Tray,
    Menu: { buildFromTemplate: (t: MenuItemStub[]): MenuItemStub[] => t },
    Notification,
    nativeImage: {
      createFromPath: (): unknown => ({
        isEmpty: (): boolean => false,
        resize: (size: { width: number; height: number }): unknown => {
          stub.redimensionamentos.push(size)
          return { isEmpty: (): boolean => false }
        }
      })
    }
  }
})

// Pausar/retomar de verdade chamariam o motor de disparo com o sender real do
// WhatsApp. Aqui interessa se a bandeja pede a acao certa, com o id certo.
vi.mock('./core/campaign/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./core/campaign/service')>()
  return { ...actual, pauseCampaign: vi.fn(), resumeCampaign: vi.fn() }
})

const {
  initTray,
  destroyTray,
  refreshTray,
  applyLaunchAtLogin,
  shouldStartHidden,
  notifyMinimizedToTray
} = await import('./tray')

const FAST: SendingDefaults = {
  delayMinMs: 0,
  delayMaxMs: 0,
  restEveryN: 0,
  restDurationMs: 0,
  dailyCap: 0
}

const showWindow = vi.fn()
const requestQuit = vi.fn()

let activeSpy: ReturnType<typeof vi.spyOn>
let bloco = 0

/** Campanha real no banco: `progressOf` e `listCampaigns` leem dali. */
function seedCampaign(
  nome: string,
  total: number,
  enviados: number,
  status: CampaignStatus
): string {
  const list = createContactList(nome)
  bloco += 1
  insertContacts(
    Array.from({ length: total }, (_, i) => ({
      listId: list.id,
      name: `Contato ${i + 1}`,
      phoneE164: `+5511${String(bloco).padStart(2, '0')}${String(i).padStart(7, '0')}`,
      extraJson: null
    }))
  )
  const { rows } = pageContacts(list.id, { limit: 500 })
  const campaign = createCampaign({
    name: nome,
    listId: list.id,
    mode: 'fixed',
    config: { text: 'oi' },
    pacing: FAST
  })
  enqueueJobs(
    campaign.id,
    rows.map((c) => ({ contactId: c.id, renderedText: 'oi' }))
  )
  for (let i = 0; i < enviados; i++) {
    const job = nextPendingJob(campaign.id)
    if (job) markJobSent(job.id, `wamid-${i}`)
  }
  setCampaignStatus(campaign.id, status)
  return campaign.id
}

/** Item do menu pelo rotulo, com erro legivel quando ele nao esta la. */
function item(label: string): MenuItemStub {
  const found = stub.menu.find((i) => i.label === label)
  if (!found) {
    throw new Error(
      `menu sem o item "${label}"; tem: ${stub.menu.map((i) => i.label ?? i.type).join(' | ')}`
    )
  }
  return found
}

/** Primeiro item do menu: o resumo do disparo, sempre desabilitado. */
function resumo(): MenuItemStub {
  return stub.menu[0]
}

beforeAll(async () => {
  await initDb()
  campaignEvents.removeAllListeners()
  activeSpy = vi.spyOn(campaignRunner, 'activeCampaignId', 'get')
  initTray({ showWindow, requestQuit })
})

afterAll(() => {
  campaignEvents.removeAllListeners()
  activeSpy.mockRestore()
})

beforeEach(() => {
  // O banco e compartilhado no arquivo: aposenta as campanhas dos testes
  // anteriores para a bandeja so enxergar a deste teste.
  for (const c of listCampaigns()) setCampaignStatus(c.id, 'done')
  stub.notificacoes = []
  stub.redimensionamentos = []
  stub.loginItem = null
  stub.empacotado = false
  stub.abertoNoLogin = false
  activeSpy.mockReturnValue(null)
  vi.mocked(pauseCampaign).mockClear()
  vi.mocked(resumeCampaign).mockClear()
  showWindow.mockClear()
  requestQuit.mockClear()
})

describe('menu da bandeja', () => {
  it('sem disparo, nao oferece pausar nem retomar', () => {
    refreshTray()

    expect(resumo().label).toBe('Nenhum disparo em andamento')
    expect(resumo().enabled).toBe(false)
    expect(item('Pausar disparo').enabled).toBe(false)
    expect(item('Retomar disparo').enabled).toBe(false)
  })

  it('com campanha rodando, mostra o progresso e so deixa pausar', () => {
    const id = seedCampaign('Rodando', 5, 2, 'running')
    activeSpy.mockReturnValue(id)

    refreshTray()

    expect(resumo().label).toBe('Disparando: 2/5 · 2 enviados')
    expect(stub.tooltip).toBe('Dispar Flux — Disparando: 2/5 · 2 enviados')
    expect(item('Pausar disparo').enabled).toBe(true)
    expect(item('Retomar disparo').enabled).toBe(false)
  })

  it('com campanha pausada e fila pendente, so deixa retomar', () => {
    seedCampaign('Pausada', 5, 2, 'paused')

    refreshTray()

    expect(resumo().label).toBe('Pausado: 2/5 · 2 enviados')
    expect(item('Pausar disparo').enabled).toBe(false)
    expect(item('Retomar disparo').enabled).toBe(true)
  })

  it('campanha pausada com a fila toda enviada nao conta como disparo em andamento', () => {
    // Sem a checagem de fila pendente, uma campanha antiga que ficou marcada
    // como pausada apareceria para sempre na bandeja.
    seedCampaign('Pausada e vazia', 3, 3, 'paused')

    refreshTray()

    expect(resumo().label).toBe('Nenhum disparo em andamento')
    expect(item('Retomar disparo').enabled).toBe(false)
  })

  it('pausar pelo menu pede a pausa ao motor', () => {
    const id = seedCampaign('Para pausar', 4, 1, 'running')
    activeSpy.mockReturnValue(id)
    refreshTray()

    item('Pausar disparo').click?.()

    expect(pauseCampaign).toHaveBeenCalledTimes(1)
  })

  it('retomar pelo menu retoma a campanha certa', () => {
    const id = seedCampaign('Para retomar', 4, 1, 'paused')
    refreshTray()

    item('Retomar disparo').click?.()

    expect(resumeCampaign).toHaveBeenCalledWith(id)
  })

  it('o menu se atualiza sozinho quando o disparo avanca', () => {
    const id = seedCampaign('Avancando', 4, 1, 'running')
    activeSpy.mockReturnValue(id)
    refreshTray()
    expect(resumo().label).toBe('Disparando: 1/4 · 1 enviados')

    const job = nextPendingJob(id)
    markJobSent(job!.id, 'wamid-novo')
    campaignEvents.emit('progress', { campaignId: id })

    expect(resumo().label).toBe('Disparando: 2/4 · 2 enviados')
  })

  it('abrir pelo menu e clicar no icone trazem a janela de volta', () => {
    refreshTray()

    item('Abrir Dispar Flux').click?.()
    stub.aoClicar?.()

    expect(showWindow).toHaveBeenCalledTimes(2)
  })

  it('sair pelo menu e o unico caminho que encerra o app', () => {
    refreshTray()

    item('Sair').click?.()

    expect(requestQuit).toHaveBeenCalledTimes(1)
  })

  it('reduz o icone para 16px (o de 512 sai esticado na bandeja)', () => {
    notifyMinimizedToTray()

    expect(stub.redimensionamentos).toContainEqual({ width: 16, height: 16 })
  })
})

describe('notificacoes', () => {
  it('avisa quando a campanha termina, com o total enviado', () => {
    const id = seedCampaign('Terminou', 3, 3, 'running')
    activeSpy.mockReturnValue(id)

    campaignEvents.emit('stopped', { campaignId: id, reason: 'done' })

    expect(stub.notificacoes).toHaveLength(1)
    expect(stub.notificacoes[0].body).toContain('3 enviados')
  })

  it('avisa quando bate o teto diario', () => {
    const id = seedCampaign('Teto', 5, 2, 'paused')

    campaignEvents.emit('stopped', { campaignId: id, reason: 'dailyCap' })

    expect(stub.notificacoes[0].body).toContain('teto diario')
  })

  it('avisa quando o WhatsApp cai no meio do disparo', () => {
    const id = seedCampaign('Caiu', 5, 2, 'paused')

    campaignEvents.emit('stopped', { campaignId: id, reason: 'disconnected' })

    expect(stub.notificacoes[0].body).toContain('desconectou')
  })

  it('nao notifica pausa nem cancelamento pedidos pelo proprio usuario', () => {
    const id = seedCampaign('Pedido do usuario', 5, 2, 'paused')

    campaignEvents.emit('stopped', { campaignId: id, reason: 'paused' })
    campaignEvents.emit('stopped', { campaignId: id, reason: 'canceled' })

    expect(stub.notificacoes).toEqual([])
  })

  it('clicar na notificacao abre a janela', () => {
    const id = seedCampaign('Clique', 2, 2, 'running')
    activeSpy.mockReturnValue(id)
    campaignEvents.emit('stopped', { campaignId: id, reason: 'done' })

    stub.aoClicarNotificacao?.()

    expect(showWindow).toHaveBeenCalledTimes(1)
  })

  it('explica para onde a janela foi na primeira vez que o app some', () => {
    notifyMinimizedToTray()

    expect(stub.notificacoes[0].body).toContain('bandeja')
    expect(stub.notificacoes[0].body).toContain('Sair')
  })
})

describe('iniciar com o sistema', () => {
  it('nao registra nada em dev', () => {
    // Registrar o Electron de desenvolvimento deixaria um item de
    // inicializacao quebrado na maquina de quem desenvolve.
    applyLaunchAtLogin(true)

    expect(stub.loginItem).toBeNull()
  })

  it('no app instalado, sobe direto para a bandeja', () => {
    stub.empacotado = true

    applyLaunchAtLogin(true)

    expect(stub.loginItem).toEqual({ openAtLogin: true, args: ['--hidden'] })
  })

  it('desliga quando o usuario desmarca', () => {
    stub.empacotado = true

    applyLaunchAtLogin(false)

    expect(stub.loginItem).toEqual({ openAtLogin: false, args: ['--hidden'] })
  })

  it('abre com janela quando foi o usuario que abriu o app', () => {
    expect(shouldStartHidden()).toBe(false)
  })

  it('abre escondido com --hidden ou quando quem abriu foi o sistema', () => {
    process.argv.push('--hidden')
    try {
      expect(shouldStartHidden()).toBe(true)
    } finally {
      process.argv.pop()
    }

    stub.abertoNoLogin = true
    expect(shouldStartHidden()).toBe(true)
  })
})

/** Estes ficam por ultimo: mexem no ciclo de vida do icone. */
describe('resiliencia', () => {
  it('destroyTray solta o icone', () => {
    destroyTray()

    expect(stub.destruidos).toBe(1)
  })

  it('sistema sem bandeja nao derruba o app', () => {
    stub.falhaAoCriar = true

    expect(() => initTray({ showWindow, requestQuit })).not.toThrow()
    // E sem icone o refresh tambem nao pode estourar.
    expect(() => refreshTray()).not.toThrow()
  })
})
