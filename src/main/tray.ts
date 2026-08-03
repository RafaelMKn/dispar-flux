import { app, Tray, Menu, Notification, nativeImage } from 'electron'
import { join } from 'node:path'
import { campaignEvents, campaignRunner, type StopReason } from './core/campaign/worker'
import { pauseCampaign, resumeCampaign, progressOf } from './core/campaign/service'
import { listCampaigns } from './repos/campaigns'
import { scoped } from './logger'
import type { CampaignProgress } from '@shared/types'

const log = scoped('tray')

/**
 * Icone da bandeja e o que mantem o app util com a janela fechada.
 *
 * O motor de disparo ja rodava no processo main, ou seja, ja era independente
 * da janela — o que faltava era o app nao morrer quando a janela fecha e o
 * usuario ter como ver o progresso e agir sem reabrir a tela.
 */

let tray: Tray | null = null
let showWindow: () => void = () => {}
let requestQuit: () => void = () => {}

/**
 * O icone precisa existir dentro do pacote, entao `build/icon.png` entra na
 * lista `files` do electron-builder. `getAppPath()` aponta para a raiz do
 * projeto em dev e para o asar no app instalado, servindo aos dois casos.
 */
function trayIcon(): Electron.NativeImage {
  const image = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
  if (image.isEmpty()) return image
  // Sem redimensionar, o Windows estica um icone de 512px na bandeja.
  return image.resize({ width: 16, height: 16 })
}

/** Campanha em execucao, ou pausada com fila pendente. Mesma regra do IPC. */
function currentProgress(): CampaignProgress | null {
  const active = campaignRunner.activeCampaignId
  if (active) return progressOf(active)
  for (const c of listCampaigns()) {
    if (c.status === 'running' || c.status === 'paused') {
      const p = progressOf(c.id)
      if (p.pending > 0) return p
    }
  }
  return null
}

function progressLabel(p: CampaignProgress | null): string {
  if (!p) return 'Nenhum disparo em andamento'
  const done = p.sent + p.failed + p.skipped + p.unknown
  const running = campaignRunner.activeCampaignId === p.campaignId
  return `${running ? 'Disparando' : 'Pausado'}: ${done}/${p.total} · ${p.sent} enviados`
}

export function refreshTray(): void {
  if (!tray) return

  const progress = currentProgress()
  const running = Boolean(campaignRunner.activeCampaignId)
  const resumable = progress && !running && progress.pending > 0

  tray.setToolTip(`Dispar Flux — ${progressLabel(progress)}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: progressLabel(progress), enabled: false },
      { type: 'separator' },
      { label: 'Abrir Dispar Flux', click: () => showWindow() },
      { type: 'separator' },
      {
        label: 'Pausar disparo',
        enabled: running,
        click: () => {
          void pauseCampaign()
          refreshTray()
        }
      },
      {
        label: 'Retomar disparo',
        enabled: Boolean(resumable),
        click: () => {
          if (progress) void resumeCampaign(progress.campaignId)
          refreshTray()
        }
      },
      { type: 'separator' },
      { label: 'Sair', click: () => requestQuit() }
    ])
  )
}

/** Notificacao do sistema. Exportada para a agenda avisar dos compromissos. */
export function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, icon: trayIcon() })
  // Clicar na notificacao traz a janela: o usuario acabou de ser avisado de
  // algo, o passo seguinte e sempre olhar a tela.
  notification.on('click', () => showWindow())
  notification.show()
}

/**
 * Avisos que valem interromper o usuario.
 *
 * Pausa e cancelamento pedidos por ele mesmo nao entram: notificar uma acao que
 * a pessoa acabou de tomar e so ruido.
 */
const NOTIFIABLE: Partial<Record<StopReason, (p: CampaignProgress | null) => string>> = {
  done: (p) => `Todos os envios foram processados${p ? `: ${p.sent} enviados` : ''}.`,
  dailyCap: () => 'O teto diario de envios foi atingido. O disparo continua amanha.',
  disconnected: () =>
    'O WhatsApp desconectou e o disparo parou. Reconecte para retomar de onde parou.'
}

export function initTray(handlers: { showWindow: () => void; requestQuit: () => void }): void {
  showWindow = handlers.showWindow
  requestQuit = handlers.requestQuit

  try {
    tray = new Tray(trayIcon())
  } catch (e) {
    // Sem bandeja o app ainda funciona; so nao da para rodar escondido.
    log.error('nao foi possivel criar o icone da bandeja', e)
    return
  }

  tray.setIgnoreDoubleClickEvents(true)
  tray.on('click', () => showWindow())
  refreshTray()

  campaignEvents.on('progress', () => refreshTray())
  campaignEvents.on('stopped', ({ reason }: { campaignId: string; reason: StopReason }) => {
    const progress = currentProgress()
    refreshTray()
    const message = NOTIFIABLE[reason]
    if (message) notify('Dispar Flux', message(progress))
  })

  log.info('bandeja do sistema pronta')
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** Explica para onde a janela foi, na primeira vez que o app some na bandeja. */
export function notifyMinimizedToTray(): void {
  notify(
    'Dispar Flux continua rodando',
    'A janela foi fechada, mas o app segue na bandeja e o disparo continua. Para encerrar de vez, clique com o botao direito no icone e escolha Sair.'
  )
}

/**
 * Aplica a preferencia de iniciar com o sistema.
 *
 * `--hidden` faz o app subir direto para a bandeja: abrir uma janela sozinha no
 * login do usuario seria invasivo.
 */
export function applyLaunchAtLogin(enabled: boolean): void {
  // Em dev o executavel e o proprio Electron; registrar isso deixaria um item
  // de inicializacao quebrado na maquina de quem desenvolve.
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

/** O app foi aberto pelo sistema (ou com --hidden) e deve comecar escondido? */
export function shouldStartHidden(): boolean {
  return process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
}
